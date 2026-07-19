cask "noetica-nightly" do
  version "0.4.23-nightly.20260719.095045"
  sha256 "a27c91506a48f4a414de3fdec81bb547fa43be077972cc640600b7a868a332fd"

  url "https://github.com/SocioProphet/Noetica/releases/download/v0.4.23-nightly.20260719.095045/Noetica_0.4.23_universal.dmg"
  # version, sha256, and url are updated automatically by the update-cask CI job
  # after each nightly release. Run `brew upgrade --cask noetica-nightly` each morning.
  name "Noetica Nightly"
  desc "Local-first AI workstation (nightly build) — knowledge graph, attention economics, A2A zero-trust"
  homepage "https://github.com/SocioProphet/Noetica"

  depends_on macos: :ventura

  conflicts_with cask: "noetica"

  app "Noetica.app"

  caveats <<~EOS
    This is the NIGHTLY channel — fresh every morning, less stable than the
    tagged release. Update with: brew update && brew upgrade --cask noetica-nightly

    If macOS Gatekeeper blocks the app after install, run:
      sudo xattr -dr com.apple.quarantine /Applications/Noetica.app
  EOS

  zap trash: [
    "~/Library/Application Support/ai.noetica.app",
    "~/Library/Logs/ai.noetica.app",
    "~/Library/Preferences/ai.noetica.app.plist",
    "~/Library/Saved Application State/ai.noetica.app.savedState",
    "~/.noetica",
  ]
end
