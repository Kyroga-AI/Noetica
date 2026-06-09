cask "noetica" do
  version "0.1.0"
  sha256 :no_check # Updated automatically by release workflow

  url "https://github.com/SocioProphet/Noetica/releases/download/v#{version}/Noetica_#{version}_aarch64.dmg"
  name "Noetica"
  desc "Governed AI workstation shell with steering, benchmarking, and evidence"
  homepage "https://github.com/SocioProphet/Noetica"

  depends_on macos: ">= :ventura"

  app "Noetica.app"

  zap trash: [
    "~/Library/Application Support/ai.noetica.app",
    "~/Library/Logs/ai.noetica.app",
    "~/Library/Preferences/ai.noetica.app.plist",
    "~/Library/Saved Application State/ai.noetica.app.savedState",
  ]
end
