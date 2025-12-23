import { cli, command } from "cleye";
import { generate } from "./commands/generate.js";
import { verifyCommand } from "./commands/verify.js";
import { list } from "./commands/list.js";
import { DEFAULT_PATH } from "./lockfile/lockfile.js";
import pkg from "../package.json";

// Common flags shared across commands
const commonFlags = {
  workflows: {
    type: String,
    alias: "w",
    description: "Path to workflows directory",
    default: ".github/workflows",
  },
  output: {
    type: String,
    alias: "o",
    description: "Path to lockfile",
    default: DEFAULT_PATH,
  },
} as const;

const generateCommand = command(
  {
    name: "generate",
    help: {
      description: "Generate or update the lockfile",
    },
    flags: {
      ...commonFlags,
      token: {
        type: String,
        alias: "t",
        description: "GitHub token (or use GITHUB_TOKEN env var)",
      },
      requireSha: {
        type: Boolean,
        description: "Require all action refs to be full SHAs (40 hex chars)",
        default: false,
      },
    },
  },
  async (argv) => {
    try {
      await generate(argv.flags);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(2);
    }
  }
);

const verifyCommandDef = command(
  {
    name: "verify",
    help: {
      description: "Verify workflows match the lockfile",
    },
    flags: {
      ...commonFlags,
      comment: {
        type: Boolean,
        alias: "c",
        description: "Post PR comment on verification failure",
        default: true,
      },
      skipSha: {
        type: Boolean,
        description: "Skip SHA resolution verification",
        default: false,
      },
      skipIntegrity: {
        type: Boolean,
        description: "Skip integrity hash verification",
        default: false,
      },
      skipAdvisories: {
        type: Boolean,
        description: "Skip security advisory checking",
        default: false,
      },
      token: {
        type: String,
        alias: "t",
        description: "GitHub token (or use GITHUB_TOKEN env var)",
      },
    },
  },
  async (argv) => {
    try {
      await verifyCommand(argv.flags);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(2);
    }
  }
);

const listCommand = command(
  {
    name: "list",
    help: {
      description: "Display the dependency tree of all locked actions",
    },
    flags: {
      ...commonFlags,
    },
  },
  async (argv) => {
    try {
      await list(argv.flags);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(2);
    }
  }
);

const argv = cli({
  name: "gh-actions-lockfile",
  version: pkg.version,
  commands: [generateCommand, verifyCommandDef, listCommand],
});

// Handle unknown commands
if (!argv.command && argv._.length > 0) {
  const unknownCommand = argv._[0];
  console.error(`Error: Unknown command '${unknownCommand}'`);
  console.error("Run 'gh-actions-lockfile --help' for available commands.");
  process.exit(1);
}
