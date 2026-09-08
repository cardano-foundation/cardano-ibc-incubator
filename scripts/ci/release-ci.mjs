import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function requireSuccessfulMainCI(pages, sha) {
  if (!Array.isArray(pages) || !pages.every((page) => Array.isArray(page.workflow_runs))) {
    throw new Error('Invalid CI run response. Release publishing is blocked.');
  }
  const runs = pages.flatMap((page) => page.workflow_runs).filter((run) =>
    run.head_sha === sha && run.head_branch === 'main' && run.event === 'push' &&
    run.path === '.github/workflows/ci.yml');
  const latest = runs.sort((a, b) => b.id - a.id)[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') {
    throw new Error(`The latest main CI run for ${sha} must complete successfully before release. ` +
      `Wait for or fix CI, then rerun this release workflow. ${latest?.html_url ?? 'No matching run found.'}`);
  }
  return latest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const repository = process.env.GITHUB_REPOSITORY;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Invalid repository.');
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main']);
    const pages = JSON.parse(execFileSync('gh', [
      'api', '--method', 'GET', '--paginate', '--slurp',
      `repos/${repository}/actions/workflows/ci.yml/runs`,
      '-f', `head_sha=${sha}`, '-f', 'branch=main', '-f', 'event=push', '-f', 'per_page=100',
    ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
    const run = requireSuccessfulMainCI(pages, sha);
    console.log(`Release commit passed main CI: ${run.html_url}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
