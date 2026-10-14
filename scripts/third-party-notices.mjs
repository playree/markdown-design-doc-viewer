/**
 * Writes ThirdPartyNotices.txt: the licenses of the npm packages bundled into the scripts of the extension, the command
 * line and the desktop app, which the .vsix, the npm package and the installers include.
 *
 *   pnpm notices
 *
 * The packages are those of the bundles (scripts/build-options.mjs, built here without writing them, in production as
 * released), taken from esbuild's metafile: only the files that end up in a bundle count. The license texts are the
 * LICENSE, NOTICE and such files of each package. The material not from npm (scripts/third-party-notices.extra.txt) is
 * written as is. CI fails when the file is out of date: run this after changing the dependencies or the bundles.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { buildOptions } from './build-options.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'ThirdPartyNotices.txt';
const EXTRA = 'scripts/third-party-notices.extra.txt';

/** What each output of the bundles is shipped in (.vscodeignore, FILES of scripts/npm-package.mjs, tauri.conf.json). */
const ARTIFACTS = [
  { name: 'the extension', outputs: ['dist/extension.js', 'dist/webview.js', 'dist/webview.css', 'dist/export.js', 'dist/export.css'] },
  { name: 'the command line', outputs: ['dist/cli.js', 'dist/webview.js', 'dist/webview.css', 'dist/export.js', 'dist/export.css'] },
  { name: 'the desktop app', outputs: ['desktop/dist/app.js', 'desktop/dist/app.css'] },
];

/** Packages with no license text in their npm package: the package to take it from (same project and copyright). */
const LICENSE_FROM = {
  // Tauri's plugins-workspace, under the same licenses as Tauri.
  '@tauri-apps/plugin-dialog': '@tauri-apps/api',
};

/** The files of a package with its license or notices: LICENSE, LICENSE-MIT, LICENSE.md, NOTICE, COPYING... */
const isLicenseFile = (name) => /^(licen[cs]e|notice|copying)([-._].*)?$/i.test(name) && !/\.(spdx|[cm]?js|json|ts)$/i.test(name);

const LINE = '='.repeat(80);

/** A license text with LF line endings, without a BOM, trailing spaces or blank lines at its start and end. */
const normalize = (text) =>
  text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');

/** Compares strings by their code units, whatever the locale: the file has to come out the same in CI. */
const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Compares versions such as 1.10.0 and 1.9.2 by their numbers, and the other parts (rc of 1.0.0-rc.1) as strings. */
function compareVersions(a, b) {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined || pb[i] === undefined) {
      return pa.length - pb.length;
    }
    const numeric = /^\d+$/.test(pa[i]) && /^\d+$/.test(pb[i]);
    const diff = numeric ? Number(pa[i]) - Number(pb[i]) : compareStrings(pa[i], pb[i]);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** The web page of the repository of a package.json, or its homepage. */
function repositoryUrl(pkg) {
  let url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!url) {
    return pkg.homepage;
  }
  url = url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/^github:/, '')
    .replace(/^gitlab:/, 'https://gitlab.com/')
    .replace(/^bitbucket:/, 'https://bitbucket.org/')
    .replace(/\.git$/, '');
  return /^[\w.-]+\/[\w.-]+$/.test(url) ? `https://github.com/${url}` : url;
}

/** The license of a package.json as an SPDX expression, if it has one. */
function licenseOf(pkg) {
  const license = pkg.license ?? pkg.licenses;
  if (Array.isArray(license)) {
    return license.map((item) => item.type ?? item).join(' OR ');
  }
  const spdx = typeof license === 'object' ? license?.type : license;
  // Without the parentheses of an expression such as (MPL-2.0 OR Apache-2.0): it is written in parentheses here.
  return spdx?.replace(/^\((.*)\)$/, '$1');
}

/** "a", "a and b", "a, b and c". */
const list = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

process.chdir(ROOT);

// The packages (by their folder in node_modules) of each output of the bundles.
const outputsOf = new Map();
const results = await Promise.all(
  [false, true]
    .flatMap((desktop) => buildOptions({ production: true, desktop }))
    .map((options) => esbuild.build({ ...options, write: false, metafile: true, logLevel: 'warning' })),
);
for (const result of results) {
  for (const [output, { inputs }] of Object.entries(result.metafile.outputs)) {
    for (const [input, { bytesInOutput }] of Object.entries(inputs)) {
      const dir = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1];
      if (dir && bytesInOutput > 0) {
        if (!outputsOf.has(dir)) {
          outputsOf.set(dir, new Set());
        }
        outputsOf.get(dir).add(output);
      }
    }
  }
}

const unassigned = [...new Set([...outputsOf.values()].flatMap((outputs) => [...outputs]))].filter((output) => !ARTIFACTS.some((artifact) => artifact.outputs.includes(output)));
if (unassigned.length > 0) {
  throw new Error(`${unassigned.join(', ')}: add to ARTIFACTS in scripts/third-party-notices.mjs.`);
}

const packages = [...outputsOf]
  .map(([dir, outputs]) => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return {
      dir,
      name: pkg.name,
      version: pkg.version,
      license: licenseOf(pkg),
      url: repositoryUrl(pkg),
      artifacts: ARTIFACTS.filter((artifact) => artifact.outputs.some((output) => outputs.has(output))).map((artifact) => artifact.name),
    };
  })
  .sort((a, b) => compareStrings(a.name, b.name) || compareVersions(a.version, b.version));

/** The license texts of a package, each file with its name if there are several. */
function licenseText(pkg) {
  // The newest version of that package if several are bundled (they are sorted by version).
  const from = LICENSE_FROM[pkg.name] ? packages.findLast((other) => other.name === LICENSE_FROM[pkg.name]) : pkg;
  if (!from) {
    throw new Error(`${pkg.name}: ${LICENSE_FROM[pkg.name]} (LICENSE_FROM) is not bundled.`);
  }
  const files = readdirSync(from.dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isLicenseFile(entry.name))
    .map((entry) => entry.name)
    .sort(compareStrings);
  if (files.length === 0) {
    return undefined;
  }
  const texts = files.map((file) => normalize(readFileSync(join(from.dir, file), 'utf8')));
  return files.length === 1 ? texts[0] : files.map((file, i) => `--- ${file} ---\n\n${texts[i]}`).join('\n\n');
}

// The packages with the same license text (a license and copyright shared by a project's packages) share a section.
const sections = new Map();
const missing = [];
for (const pkg of packages) {
  const text = licenseText(pkg);
  if (text === undefined) {
    missing.push(`${pkg.name}@${pkg.version}`);
    continue;
  }
  if (!sections.has(text)) {
    sections.set(text, []);
  }
  sections.get(text).push(pkg);
}
if (missing.length > 0) {
  throw new Error(`No license file in ${missing.join(', ')}: add the package to take it from to LICENSE_FROM in scripts/third-party-notices.mjs.`);
}

const header = `Markdown Design Doc Viewer includes the following third-party material.

The npm packages are bundled into the scripts of the extension, the command line and the desktop app; each is listed
with what it is bundled in, its license and its repository, where its source code is available (also on npm).
This file is generated by scripts/third-party-notices.mjs (pnpm notices).
The licenses of the Rust crates of the desktop app are in ThirdPartyLicenses.txt, next to this file in the desktop app
(desktop/src-tauri/ThirdPartyLicenses.txt in the repository).`;

const parts = [header, normalize(readFileSync(EXTRA, 'utf8'))];
for (const [text, pkgs] of sections) {
  const names = pkgs.flatMap((pkg) => [
    `${pkg.name} ${pkg.version}${pkg.license ? ` (${pkg.license})` : ''}${pkg.url ? `: ${pkg.url}` : ''}`,
    `  in ${list(pkg.artifacts)}`,
  ]);
  parts.push(`${LINE}\n${names.join('\n')}\n${LINE}\n\n${text}`);
}
writeFileSync(OUT, `${parts.join('\n\n')}\n`);
console.log(`${OUT}: ${packages.length} npm packages, ${sections.size} license texts.`);
