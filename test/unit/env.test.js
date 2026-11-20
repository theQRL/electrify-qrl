var test   = require('node:test');
var assert = require('node:assert');
var path   = require('path');

var helpers = require('./helpers');
var Env     = require('../../lib/env');
var pkg     = require('../../package.json');

test('name and version come from package.json', function(t) {
  var env = Env(helpers.electrify_dir(t), null, {}, true, {});
  assert.strictEqual(env.name, pkg.name);
  assert.strictEqual(env.version, pkg.version);
});

test('child stdio is inherited in CI, ignored otherwise', function(t) {
  var dir = helpers.electrify_dir(t);
  var ci = process.env.CI, level = process.env.LOGELECTRIFY;
  t.after(function(){
    restore('CI', ci);
    restore('LOGELECTRIFY', level);
  });

  delete process.env.LOGELECTRIFY;

  delete process.env.CI;
  assert.strictEqual(Env(dir, null, {}, true, {}).stdio, 'ignore');

  process.env.CI = 'true';
  assert.strictEqual(Env(dir, null, {}, true, {}).stdio, 'inherit');
});

test('an unpackaged app survives a missing global meteor install', function(t) {
  var dir = helpers.electrify_dir(t);
  var home = process.env.HOME, profile = process.env.USERPROFILE;
  t.after(function(){
    restore('HOME', home);
    restore('USERPROFILE', profile);
  });

  // no `.meteor` in there
  process.env.HOME = process.env.USERPROFILE = helpers.tmpdir(t);

  var env = Env(dir, null, {}, true, {});
  assert.strictEqual(env.meteor.tools, null);
  assert.strictEqual(
    env.meteor.dev_bundle,
    path.join(dir, '..', '.meteor', 'local', 'dev_bundle')
  );
  assert.ok(env.meteor.node.startsWith(env.meteor.dev_bundle));
});

test('packaged app reads its settings', function(t) {
  var root = path.join(helpers.tmpdir(t), 'resources', 'app');
  helpers.write_json(path.join(root, 'app', 'settings.json'), {public: {a: 1}});

  var env = Env(root, null, null, false, {});
  assert.ok(env.app.is_packaged);
  assert.deepStrictEqual(env.app.settings.public, {a: 1});
});

test('unpacked asar app falls back to the settings inside the archive', function(t) {
  var resources = path.join(helpers.tmpdir(t), 'resources');
  // stands in for the archive, electron makes `app.asar` readable as a dir
  helpers.write_json(path.join(resources, 'app.asar', 'app', 'settings.json'), {public: {b: 2}});

  var env = Env(path.join(resources, 'app.asar.unpacked'), null, null, false, {});
  assert.deepStrictEqual(env.app.settings.public, {b: 2});
});

function restore(name, value) {
  if(value === undefined) delete process.env[name];
  else process.env[name] = value;
}
