cask "noetica" do
  version "0.4.10"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/SocioProphet/Noetica/releases/download/v#{version}/Noetica_#{version}_universal.dmg"
  # sha256 and url are updated automatically by the update-cask CI job after each tagged release.
  name "Noetica"
  desc "Local-first AI workstation with knowledge graph, attention economics, and A2A zero-trust"
  homepage "https://github.com/SocioProphet/Noetica"

  depends_on macos: :ventura

  app "Noetica.app"

  caveats <<~EOS
    Noetica requires its agent-machine sidecar to be running for full functionality.
    It starts automatically when the app launches.

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
