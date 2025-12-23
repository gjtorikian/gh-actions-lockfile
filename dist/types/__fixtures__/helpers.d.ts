export declare const FIXTURES_DIR: string;
/**
 * Copy a fixture file to a target directory
 * @param fixturePath - Relative path from __fixtures__ (e.g., "verify/workflow-match.yml")
 * @param targetPath - Absolute path where fixture should be copied
 */
export declare function copyFixture(fixturePath: string, targetPath: string): Promise<void>;
/**
 * Copy multiple fixtures to a target directory
 * @param fixtures - Array of [fixturePath, targetFileName] tuples
 * @param targetDir - Target directory (will be created if needed)
 */
export declare function copyFixtures(fixtures: Array<[string, string]>, targetDir: string): Promise<void>;
/**
 * Read a fixture file as a string
 * @param fixturePath - Relative path from __fixtures__
 */
export declare function readFixture(fixturePath: string): Promise<string>;
/**
 * Read a JSON fixture and parse it
 * @param fixturePath - Relative path from __fixtures__
 */
export declare function readJsonFixture<T>(fixturePath: string): Promise<T>;
