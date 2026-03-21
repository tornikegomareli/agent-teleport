class AgentTeleport < Formula
  desc "Convert AI coding agent sessions between formats"
  homepage "https://github.com/tornikegomareli/agent-teleport"
  url "https://github.com/tornikegomareli/agent-teleport/archive/refs/tags/v0.1.0.tar.gz"
  license "MIT"

  depends_on "oven-sh/bun/bun"

  def install
    system "bun", "install"
    system "bun", "build", "--compile", "src/index.ts", "--outfile", "agent-teleport"
    bin.install "agent-teleport"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/agent-teleport --version")
  end
end
