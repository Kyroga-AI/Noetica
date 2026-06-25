#!/usr/bin/env python3
"""train_fno.py — the PRODUCTION recipe for making a Fourier Neural Operator the sidecar can serve.

This is the reusable "how a real operator is made" pipeline: train a 2D FNO offline (once, on a GPU),
export it to a single `.onnx` with DYNAMIC spatial axes, and drop it in ~/.noetica/operators. The sidecar
(ONNX Runtime) then serves it on-device with zero cloud — resolution-invariant, so one model handles any
grid. The spectral layers use torch.fft, which exports to the ONNX `DFT` op (opset 17+); ONNX Runtime
supports it, so no custom ops are needed.

Unlike the tiny test fixtures (make_reference_model.py, no training), this needs torch:
    uv pip install torch numpy onnx
    python scripts/train_fno.py --epochs 50 --out ../models/diffusion-fno.onnx

The demo target below is a known operator (one step of heat diffusion) on random fields, so the script runs
end-to-end as a template. For a real surrogate, replace `make_batch` with (input, output) pairs from your
PDE solver — e.g. Darcy flow: input = permeability field a(x), output = pressure u(x). The network and the
export are unchanged; only the data changes.
"""
import argparse
import math
import numpy as np
import torch
import torch.nn as nn


class SpectralConv2d(nn.Module):
    """The FNO heart: a global convolution done as a learned linear map on the lowest Fourier modes.
    Truncating to `modes` makes it resolution-invariant — the same weights apply at any grid size."""

    def __init__(self, in_ch, out_ch, modes1, modes2):
        super().__init__()
        self.in_ch, self.out_ch = in_ch, out_ch
        self.modes1, self.modes2 = modes1, modes2
        scale = 1.0 / (in_ch * out_ch)
        # Complex weights for the two retained quadrants of the rfft2 spectrum.
        self.w1 = nn.Parameter(scale * torch.rand(in_ch, out_ch, modes1, modes2, dtype=torch.cfloat))
        self.w2 = nn.Parameter(scale * torch.rand(in_ch, out_ch, modes1, modes2, dtype=torch.cfloat))

    @staticmethod
    def _mul(x, w):  # (b, in, m1, m2) x (in, out, m1, m2) -> (b, out, m1, m2)
        return torch.einsum("bixy,ioxy->boxy", x, w)

    def forward(self, x):
        b, _, h, w = x.shape
        x_ft = torch.fft.rfft2(x)
        out_ft = torch.zeros(b, self.out_ch, h, w // 2 + 1, dtype=torch.cfloat, device=x.device)
        m1, m2 = self.modes1, self.modes2
        out_ft[:, :, :m1, :m2] = self._mul(x_ft[:, :, :m1, :m2], self.w1)
        out_ft[:, :, -m1:, :m2] = self._mul(x_ft[:, :, -m1:, :m2], self.w2)
        return torch.fft.irfft2(out_ft, s=(h, w))


class FNO2d(nn.Module):
    def __init__(self, modes1=12, modes2=12, width=32, in_ch=1, out_ch=1, depth=4):
        super().__init__()
        self.lift = nn.Conv2d(in_ch, width, 1)
        self.spectral = nn.ModuleList([SpectralConv2d(width, width, modes1, modes2) for _ in range(depth)])
        self.local = nn.ModuleList([nn.Conv2d(width, width, 1) for _ in range(depth)])
        self.proj1 = nn.Conv2d(width, 128, 1)
        self.proj2 = nn.Conv2d(128, out_ch, 1)

    def forward(self, x):
        x = self.lift(x)
        for spec, loc in zip(self.spectral, self.local):
            x = torch.nn.functional.gelu(spec(x) + loc(x))
        x = torch.nn.functional.gelu(self.proj1(x))
        return self.proj2(x)


def make_batch(n, size, device):
    """DEMO target: smooth random fields and apply one explicit heat-diffusion step (a known operator).
    Swap this for real (a, u) pairs from a PDE solver to learn a real surrogate."""
    x = torch.randn(n, 1, size, size, device=device)
    # low-pass the noise so there's structure to learn
    k = torch.ones(1, 1, 5, 5, device=device) / 25.0
    x = torch.nn.functional.conv2d(x, k, padding=2)
    lap = (
        -4 * x
        + torch.roll(x, 1, 2) + torch.roll(x, -1, 2)
        + torch.roll(x, 1, 3) + torch.roll(x, -1, 3)
    )
    y = x + 0.15 * lap  # u = (I + 0.15 Δ) a   — the operator the FNO should learn
    return x, y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--out", type=str, default="../models/diffusion-fno.onnx")
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"device: {device}")
    model = FNO2d().to(device)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    lossf = nn.MSELoss()

    for ep in range(args.epochs):
        model.train()
        x, y = make_batch(args.batch, args.size, device)
        opt.zero_grad()
        loss = lossf(model(x), y)
        loss.backward()
        opt.step()
        if ep % 10 == 0 or ep == args.epochs - 1:
            print(f"epoch {ep:3d}  mse {loss.item():.6e}")

    # Export with DYNAMIC H, W so the served operator is resolution-invariant (opset 17 → ONNX DFT).
    model.eval()
    dummy = torch.randn(1, 1, args.size, args.size, device=device)
    torch.onnx.export(
        model, dummy, args.out,
        input_names=["x"], output_names=["y"],
        dynamic_axes={"x": {2: "H", 3: "W"}, "y": {2: "H", 3: "W"}},
        opset_version=17, do_constant_folding=True,
    )
    print(f"exported {args.out}  (rel L2 on a fresh batch: {eval_rel_l2(model, args, device):.4f})")


def eval_rel_l2(model, args, device):
    model.eval()
    with torch.no_grad():
        x, y = make_batch(8, args.size, device)
        pred = model(x)
        num = torch.linalg.norm((pred - y).reshape(8, -1), dim=1)
        den = torch.linalg.norm(y.reshape(8, -1), dim=1).clamp_min(1e-8)
        return (num / den).mean().item()


if __name__ == "__main__":
    main()
