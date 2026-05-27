import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  description?: string;
  author?: unknown;
  contributors?: unknown;
  license?: string;
  homepage?: string;
  repository?: unknown;
  bugs?: unknown;
  keywords?: string[];
  packageManager?: string;
  publishConfig?: {
    access?: 'public' | 'restricted';
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ReadPackageResult {
  raw: string;
  parsed: PackageJson;
  indent: string;
  hasTrailingNewline: boolean;
}

export async function readPackage(cwd: string): Promise<ReadPackageResult> {
  const filePath = join(cwd, 'package.json');
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as PackageJson;

  const indentMatch = raw.match(/\n([ \t]+)"/);
  const indent = indentMatch ? indentMatch[1] : '  ';
  const hasTrailingNewline = raw.endsWith('\n');

  return { raw, parsed, indent, hasTrailingNewline };
}

export async function writePackageAccess(
  cwd: string,
  result: ReadPackageResult,
  access: 'public' | 'restricted'
): Promise<void> {
  const { parsed, indent, hasTrailingNewline } = result;

  const updated: PackageJson = {
    ...parsed,
    publishConfig: {
      ...parsed.publishConfig,
      access,
    },
  };

  let content = JSON.stringify(updated, null, indent);
  if (hasTrailingNewline) content += '\n';

  await writeFile(join(cwd, 'package.json'), content, 'utf8');
}
