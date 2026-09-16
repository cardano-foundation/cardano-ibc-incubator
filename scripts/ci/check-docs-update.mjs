#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function onlyMarkdownChanged(repo, before, after) {
  const git = (...args) => new TextDecoder('utf-8', { fatal: true }).decode(
    execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }));
  git('merge-base', '--is-ancestor', before, after);
  const paths = git('diff', '--name-only', '--no-renames', '-z', before, after).split('\0').filter(Boolean);
  return paths.length > 0 && paths.every((path) => {
    if (!path.endsWith('.md')) return false;
    // A renamed source, executable file or symlink is not a documentation edit.
    return [before, after].every((ref) => {
      const entry = git('--literal-pathspecs', 'ls-tree', '-z', ref, '--', path);
      return entry === '' || entry.startsWith('100644 blob ');
    });
  });
}

export async function checkDocsUpdate({ eventName, event, workflow, repo = process.cwd(), api }) {
  const run = (reason) => ({ runJobs: true, reason });
  if (eventName !== 'pull_request' || event.action !== 'synchronize') {
    return run('This is not a pull-request update.');
  }
  try {
    const before = event.before;
    const after = event.after;
    const base = event.pull_request?.base?.sha;
    if (![before, after, base].every((sha) => /^[0-9a-f]{40}$/.test(sha ?? '')) ||
        event.pull_request.head.sha !== after) {
      return run('The update does not have unambiguous commit identities.');
    }
    if (!onlyMarkdownChanged(repo, before, after)) {
      return run('The update includes changes other than Markdown documentation.');
    }
    const pages = await api(`actions/workflows/${workflow.split('/').at(-1)}/runs`, {
      head_sha: before, event: 'pull_request', per_page: '100',
    });
    const candidates = pages.flatMap((page) => page.workflow_runs).filter((candidate) =>
      candidate.path === workflow && candidate.head_sha === before &&
      candidate.event === 'pull_request' && candidate.status === 'completed' &&
      candidate.conclusion === 'success' && candidate.pull_requests?.some((pr) =>
        pr.number === event.number && pr.base.sha === base));
    if (candidates.length !== 1) {
      return run('No unique successful previous workflow run exists for this PR and base.');
    }
    const previous = candidates[0];
    if (!Number.isSafeInteger(previous.id) || previous.id < 1 ||
        !Number.isSafeInteger(previous.run_attempt) || previous.run_attempt < 1) {
      return run('The previous workflow response has invalid run identifiers.');
    }
    const jobs = (await api(`actions/runs/${previous.id}/jobs`, {
      filter: 'latest', per_page: '100',
    })).flatMap((page) => page.jobs);
    // PR metadata in the runs API can change later. Require the base recorded
    // by the previous run itself, including when that run reused an earlier one.
    const attestations = jobs.filter((job) =>
      job.run_attempt === previous.run_attempt && job.status === 'completed' && job.conclusion === 'success')
      .flatMap((job) => job.steps ?? []).filter((step) =>
        step.name === `Attest workflow base ${base}` &&
        step.status === 'completed' && step.conclusion === 'success');
    if (attestations.length !== 1) {
      return run('The previous workflow did not attest successful checks against this base.');
    }
    return {
      runJobs: false,
      reason: `Markdown-only update, reusing successful ${workflow} run ${previous.id} for ${before} against ${base}.`,
    };
  } catch (error) {
    return run(`Could not verify reusable checks, running jobs: ${error.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const decision = await checkDocsUpdate({
    eventName: process.env.GITHUB_EVENT_NAME,
    event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    workflow: process.env.WORKFLOW_PATH,
    api: async (path, parameters) => {
      const args = ['api', '--method', 'GET', `repos/${process.env.GITHUB_REPOSITORY}/${path}`, '--paginate', '--slurp'];
      for (const [key, value] of Object.entries(parameters)) args.push('-f', `${key}=${value}`);
      return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
    },
  });
  console.log(decision.reason);
  appendFileSync(process.env.GITHUB_OUTPUT, `run_jobs=${decision.runJobs}\n`);
}
