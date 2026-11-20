# Upgrading from 1.1.3 to 2.0.0

2.0.0 is the first release since 1.1.3. It brings electrify up to date with
current Node.js, Electron and Meteor. `npm audit` reported 17 vulnerabilities,
three of them critical, on the 1.1.3 lockfile; on the 2.0.0 lockfile it reports
none (November 2026). A few of the changes need action by consuming projects.

## At a glance

| Area | 1.1.3 | 2.0.0 |
| --- | --- | --- |
| Node.js | 14 | 22.12 or newer |
| Electron | bundled with electrify; always packaged 16.0.1 | supplied by the app |
| Packager | `electron-packager` 15 | `@electron/packager` 20 |
| `electrify.methods()` | always available | needs `sockjs` installed by the app |
| `.electrify` install | `npm install` | `npm ci` when a lockfile exists |
| Failed build | could still exit 0 | exits non-zero |

## Steps

### 1. Move to Node.js 22.12 or newer

This applies to the Node.js that runs the `electrify` command. The node binary
that a packaged app uses to run its Meteor server (`.electrify/bin/node`) is
separate and unaffected.

### 2. Update electrify everywhere it is installed

Electrify is usually installed twice: once where the `electrify` command is
run from (globally, or in the Meteor project), and once inside `.electrify`,
where the packaged app loads it at runtime. Move both to 2.0.0.

````shell
# where the cli is run from
npm install --save-dev --save-exact @theqrl/electrify-qrl@2.0.0

# the copy the app ships with
cd .electrify
npm install --save-exact @theqrl/electrify-qrl@2.0.0
````

Electrify warns at build time when the version in `.electrify/package.json`
differs from the cli's.

An app scaffolded by 1.x may still depend on the unscoped `electrify-qrl`
package, which is a different, older package. In that case, inside `.electrify`:

````shell
npm uninstall electrify-qrl
````

and change the one `require` in `.electrify/index.js`, leaving the rest of the
file as it is:

````javascript
// before
const electrify = require('electrify-qrl')(__dirname);

// after
const electrify = require('@theqrl/electrify-qrl')(__dirname);
````

Both `npm` commands update `.electrify/package-lock.json`.

### 3. Add Electron to the app

Electrify no longer depends on Electron. 1.1.3 started the app with its own
copy and always packaged Electron 16.0.1, whatever version the app had
installed. 2.0.0 uses the Electron in `.electrify/node_modules` for both, and
looks nowhere else: an Electron installed in the Meteor project or globally is
ignored.

````shell
cd .electrify
npm install --save-exact electron
````

Pin an exact version. If Electron isn't installed at packaging time, electrify
falls back to the version written in `.electrify/package.json`, and stops with
an error when that is a range such as `^40.0.0` instead of an exact version.

An app that never chose an Electron version moves from Electron 16 to a
current release in one step. Check `.electrify/index.js` against
Electron's [breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)
for the versions in between.

### 4. Review packager options

Packaging now goes through [`@electron/packager`](https://github.com/electron/packager),
the successor to `electron-packager`. Options from the `electronPackager`
section of `.electrify/package.json`, and options given after `--` on the
command line, are passed to it as before, so compare the ones in use with its
current [API](https://electron.github.io/packager/main/).

Hooks such as `afterCopy` now receive a single object and return a promise, in
place of positional arguments and a callback.

````javascript
// 1.1.3
function(buildPath, electronVersion, platform, arch, callback) { /* ... */ callback(); }

// 2.0.0
async function({ buildPath, electronVersion, platform, arch }) { /* ... */ }
````

Electrify's own defaults changed slightly too. Both can be overridden:

  * `prune` defaults to `false` when packaging for Windows.
  * `quiet` defaults to `false`, so the packager's progress is shown.

### 5. Install `sockjs` for `electrify.methods()`

The socket server behind `electrify.methods()` needs `sockjs`, which is now an
optional dependency.

````shell
cd .electrify
npm install sockjs
````

Without it, no socket server is started and `electrify.methods()` throws. Apps
that don't call `electrify.methods()` need no change.

### 6. Commit a lockfile for `.electrify`

When `.electrify/package-lock.json` exists, electrify installs with `npm ci`,
so a packaged app contains exactly the locked dependencies. A lockfile that is
out of step with `package.json` now stops the build: regenerate it with
`npm install` inside `.electrify` after changing dependencies. Without a
lockfile, electrify runs `npm install` as it did before.

### 7. Remove workarounds for 1.1.3

Drop any patches applied to electrify inside `node_modules`, and any overrides
for its dependencies. In particular:

  * `shelljs`, `sockjs`, `plist`, `server-destroy` and `electron` are no longer
    dependencies of electrify. Code in `.electrify` that used one of them
    without declaring it needs it added to `.electrify/package.json`.
  * Any step that checked for, or applied, source changes to electrify 1.1.3
    will no longer match.

## Other behaviour changes

These need no action, but they may show up in builds or in the app.

**Building**

  * A failed `meteor build`, a failed dependency install and a failed packaging
    run now stop electrify with a non-zero exit code. So does a bad `--input`,
    `--output`, `--temp` or `--settings` path. Scripts that relied on electrify
    carrying on, or exiting 0, will now stop.
  * `meteor build` is run without the empty `--server` argument 1.1.3 passed,
    and its output is always shown.
  * When the `CI` environment variable is set, the output of the other commands
    electrify runs is shown as well.
  * The bundled server's `node_modules` are still copied from the Meteor
    install. When they can't be found there, electrify runs
    `meteor npm install` inside the bundle, and stops if that fails.
  * Bundling stops before the Meteor build when there is no node binary at
    `.electrify/bin/node` and none in the Meteor install to copy there. 1.1.3
    produced an app that could not start its server.
  * Electrify no longer fails to start when it can't locate a global Meteor
    install. It then looks for Meteor's `dev_bundle` inside the project's
    `.meteor/local`.
  * On Windows, `meteor` and `npm` are run through a shell, which current
    Node.js requires.

**At runtime**

  * The socket server listens on `127.0.0.1` only. It used to accept
    connections on every network interface.
  * Electrify waits up to 60 seconds for Meteor to answer. It used to wait
    forever. After that, the `electrify.start()` callback is still called with
    the url, plus an error as its second argument, so the app can load the url
    anyway, retry, or show an error:

    ````javascript
    electrify.start(function(meteor_root_url, err) {
      if (err) { /* Meteor has not answered yet */ }
    });
    ````
  * Apps packaged with `asar` are supported, provided the `app` and `bin`
    folders are unpacked:

    ````json
    {
      "electronPackager": {
        "asar": { "unpackDir": "{app,bin}" }
      }
    }
    ````

**New projects**

  * The generated `.electrify/package.json` depends on `@theqrl/electrify-qrl`
    and on `electron`, and the generated `index.js` requires
    `@theqrl/electrify-qrl`. Existing files are never overwritten.

## Checking the upgrade

1. `electrify` starts the app in development.
2. `electrify package` finishes, and its log names the pinned Electron version.
3. The packaged app opens and reaches its Meteor server.
4. `npm audit` inside `.electrify` no longer reports anything under
   `@theqrl/electrify-qrl`.
