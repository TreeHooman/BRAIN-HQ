// Prints the Claude CLI path HQ will use (helper for SIGN-IN-CLAUDE.cmd).
import { findClaude } from "../src/lib/claude.ts";
const bin = findClaude(true);
if (!bin) { console.error("Claude CLI not found"); process.exit(1); }
console.log(bin);
