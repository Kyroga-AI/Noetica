cask "noetica-nightly" do
  version "0.4.18-nightly.20260625"
  sha256 "603509971624404fe589a92ea91c369fbe6491d0d58b82d6b0a256d1cfae451a"

  url "https://github.com/SocioProphet/Noetica/releases/download/v0.4.18-nightly.20260625/Noetica_0.4.18_universal.dmg"
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
