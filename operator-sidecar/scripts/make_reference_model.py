#!/usr/bin/env python3
"""Generate the checked-in REFERENCE operator fixtures used to test the serving platform end-to-end.

These are deliberately tiny, deterministic ONNX models with DYNAMIC spatial dims (so they exercise the
resolution-invariance the real Fourier Neural Operators rely on) — and they need NO training, so the test
suite can regenerate them with just `onnx` + `numpy` (no torch, no GPU). The PRODUCTION path for a real FNO is
scripts/train_fno.py; the serving sidecar treats every `.onnx` identically, so these fixtures validate the
exact same code path a trained operator flows through.

  identity.onnx — y = x. Lets a test assert an EXACT round-trip (IO plumbing + dynamic shape).
  smooth.onnx   — y = 3x3 mean-filter(x), 'same' padding. A real Conv: proves ONNX Runtime actually computes,
                  and a constant field in → (interior) constant field out is analytically checkable.

Run:  python scripts/make_reference_model.py
"""
import os
import numpy as np
import onnx
from onnx import helper, TensorProto

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
os.makedirs(OUT_DIR, exist_ok=True)

# Shared signature: a single-channel 2D field with dynamic H, W (the resolution-invariant axes).
X = helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, 1, "H", "W"])
Y = helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, 1, "H", "W"])
OPSET = [helper.make_opsetid("", 17)]


def save(model, name):
    model.ir_version = 10  # pin to an IR version the bundled ONNX Runtime accepts
    onnx.checker.check_model(model)
    path = os.path.join(OUT_DIR, name)
    onnx.save(model, path)
    print(f"wrote {path} ({os.path.getsize(path)} bytes)")


# identity
ident = helper.make_model(
    helper.make_graph([helper.make_node("Identity", ["x"], ["y"])], "identity_operator", [X], [Y]),
    opset_imports=OPSET, producer_name="noetica-operator-fixtures",
)
save(ident, "identity.onnx")

# smooth — 3x3 averaging kernel, 'same' padding
w = np.full((1, 1, 3, 3), 1.0 / 9.0, dtype=np.float32)
W = helper.make_tensor("w", TensorProto.FLOAT, [1, 1, 3, 3], w.flatten().tolist())
smooth = helper.make_model(
    helper.make_graph(
        [helper.make_node("Conv", ["x", "w"], ["y"], kernel_shape=[3, 3], pads=[1, 1, 1, 1])],
        "smooth_operator", [X], [Y], initializer=[W],
    ),
    opset_imports=OPSET, producer_name="noetica-operator-fixtures",
)
save(smooth, "smooth.onnx")
print("done.")
