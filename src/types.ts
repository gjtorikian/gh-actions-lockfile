// Workflow types
export interface Workflow {
  name?: string;
  on?: unknown;
  jobs: Record<string, Job>;
}

export interface Job {
  name?: string;
  "runs-on"?: string;
  steps?: Step[];
  uses?: string;
}

export interface Step {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
}

// Action reference parsed from "uses" field
export interface ActionRef {
  owner: string;
  repo: string;
  ref: string;
  path?: string;
  rawUses: string;
}

export interface Lockfile {
  version: number;
  generated: string;
  actions: Record<string, LockedAction>;
}

export interface LockedAction {
  version: string;
  sha: string;
  integrity: string;
  dependencies: LockedDependency[];
}

export interface LockedDependency {
  ref: string;
  sha: string;
  integrity: string;
}

export interface VerifyResult {
  match: boolean;
  newActions: ChangeInfo[];
  changed: ChangeInfo[];
  removed: ChangeInfo[];
}

export interface ChangeInfo {
  action: string;
  oldVersion?: string;
  newVersion?: string;
  oldSha?: string;
  newSha?: string;
}

// GitHub API response types
export interface GitRef {
  ref: string;
  object: {
    sha: string;
    type: string;
  };
}

export interface GitTag {
  object: {
    sha: string;
    type: string;
  };
}

export interface FileContent {
  encoding: string;
  content: string;
  download_url: string;
}

// Action.yml structure
export interface ActionConfig {
  name?: string;
  description?: string;
  runs?: {
    using?: string;
    steps?: Array<{
      uses?: string;
      with?: Record<string, unknown>;
      run?: string;
    }>;
  };
  jobs?: Record<string, Job>;
}
