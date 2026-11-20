var _    = require('lodash');

var fs    = require('fs-extra');
var spawn = require('child_process').spawn;
var join  = require('path').join;

module.exports = function ($){
  return new App($);
};

function App($) {
  this.$ = $;
  this.log = require('./log')($, 'electrify:app');
}

// `.bat` and `.cmd` files can only be spawned through a shell on windows
// (node >= 18.20 / 20.12 / 22 throws EINVAL otherwise), and a shell needs the
// arguments quoted by hand
App.prototype.spawn = function(command, args, options) {
  if(this.$.env.os.is_windows) {
    options = _.extend({shell: true}, options);
    args = _.map(args, function(arg){
      return /[\s&()^]/.test(arg) ? '"' + arg + '"' : arg;
    });
  }
  return spawn(command, args, options);
};

App.prototype.terminate = function(done){
  this.log.info('terminating app');
  this.stop_meteor();
  this.$.plugins.stop(done);
};

App.prototype.init = function(done){
  this.log.info('initialize app');
  this.$.scaffold.prepare();
  this.$.waterfal([
    [this.ensure_deps               , this            ] ,
    [this.$.plugins.acquire         , this.$.plugins  ] ,
    [function(){ if(done) done(); } , null            ]
  ]);
};

// runs inside electron, started by the cli once `init` has installed the
// dependencies -- installing them here would rewrite the `node_modules` this
// very process is running from
App.prototype.run = function(done){
  this.log.info('running app');
  this.$.waterfal([
    [this.$.plugins.auto_load       , this.$.plugins  ] ,
    [this.$.plugins.acquire         , this.$.plugins  ] ,
    [this.$.plugins.start           , this.$.plugins  ] ,
    [this.start_meteor              , this            ] ,
    [function(){ if(done) done(); } , null            ]
  ]);
};

App.prototype.start_meteor = function(done){

  this.log.info('starting meteor');

  var command = 'meteor' + (this.$.env.os.is_windows ? '.bat' : '');
  var env     = _.clone(this.$.env.app.settings);

  _.extend(env, process.env);
  _.extend(env, this.$.plugins.env());

  var args;
  if(process.env.ELECTRIFY_SETTINGS_FILE)
    args = ['--settings', process.env.ELECTRIFY_SETTINGS_FILE];
  else
    args = [];

  this.meteor_process = this.spawn(command, args, {
    cwd: this.$.env.app.meteor,
    env: env,
    // ignore on windows and them pipe stdout and sterr bellow
    // spawning meteor with stdio=inherit on windows breaks things silently,
    // not good mr windows
    stdio: this.$.env.os.is_windows ? 'pipe' : 'inherit'
  });

  if(this.$.env.os.is_windows) {
    this.meteor_process.stdout.pipe(process.stdout);
    this.meteor_process.stderr.pipe(process.stderr);
  }

  var meteor_url = 'http://' + this.$.env.app.hostname + ':3000';
  this.$.plugins.get('nodejs').meteor_ready(meteor_url, function(){
    done(meteor_url);
  });
};

App.prototype.stop_meteor = function() {
  if(this.meteor_process)
    this.$._kill(this.meteor_process);
};

App.prototype.bundle = function(done){
  this.log.info('bundling app');
  this.$.scaffold.prepare();
  this.$.waterfal([
    [this.ensure_deps                       , this            ] ,
    [this.$.plugins.auto_load               , this.$.plugins  ] ,
    [this.$.plugins.acquire                 , this.$.plugins  ] ,
    [this.require_node                      , this            ] ,
    [this.bundle_meteor                     , this            ] ,
    [function(){ if(done) done(); }         , null            ]
  ]);
};

// a bundled app runs its meteor server on `.electrify/bin/node`, so there is
// no point in building one without it -- checked before the (slow) meteor build
App.prototype.require_node = function(done) {
  var node_path = this.$.plugins.get('nodejs').app_node_path;
  if(!fs.existsSync(node_path)) {
    throw new Error(
      'no node binary at ' + node_path + ', and none found in meteor to copy ' +
      'there -- add one for the platform being built before bundling'
    );
  }
  done();
};

App.prototype.package = function(options, done){
  var self = this;
  this.bundle(function(){
    self.$.electron.package(options, function(){
      if(done) done();
    });
  });
};

App.prototype.bundle_meteor = function( /* server_url, */ done) {
  this.log.info('bundling meteor');

  var tmp_dir             = join(this.$.env.core.tmp, 'bundling');
  var bundled_dir         = join(tmp_dir, 'bundle');
  var electrify_app_dir   = join(this.$.env.app.root, 'app');
  var programs_server_dir = join(electrify_app_dir, 'programs', 'server');
  var env     = _.clone(this.$.env.app.settings);
  _.extend(env, process.env);
  _.extend(env, this.$.plugins.env());

  // resetting folders
  fs.removeSync(tmp_dir);
  fs.ensureDirSync(tmp_dir);

  // bundle meteor
  var self = this;
  var meteor_cmd  = 'meteor' + (this.$.env.os.is_windows ? '.bat' : '');
  var meteor_args = ['build', tmp_dir, '--directory'];

  this.spawn(meteor_cmd, meteor_args, {
      cwd: this.$.env.app.meteor,
      env: env,
      // always shown, a meteor build is slow and its output is the only
      // sign of life (and the only explanation when it fails)
      stdio: 'inherit'
    }
  ).on('exit', function(code){

    if(code !== 0)
      throw new Error('meteor build failed with exit code ' + code);

    var afterBuild = function() {
        fs.ensureDirSync(bundled_dir);

        // inject meteor's settings file within the bundled app
        fs.writeFileSync(
            join(bundled_dir, 'settings.json'),
            JSON.stringify(self.$.env.app.settings, null, 2)
        );

        // move bundled meteor into .electrify
        fs.removeSync(electrify_app_dir);
        fs.moveSync(bundled_dir, electrify_app_dir);
        fs.removeSync(tmp_dir);

        self.log.info('ensuring meteor dependencies');

        // the bundled server cannot boot without its own `node_modules`.
        // instead of entering the folder and doing an usual `npm install`, we
        // just copy the whole `node_modules` folder that is officially
        // distributed with meteor, its ready to go and doesn't need to be
        // rebuilt
        var server_modules = self.$.env.meteor.server_modules;
        if(server_modules && fs.existsSync(server_modules)) {
          fs.copySync(server_modules, join(programs_server_dir, 'node_modules'));
          if(done) done();
          return;
        }

        // ...and when meteor's copy can't be found, install them the way
        // meteor documents for any bundle, with meteor's own node and npm
        self.log.warn(
          'meteor server_modules not found at ' + server_modules +
          ', installing them with `meteor npm install` instead'
        );

        self.spawn(meteor_cmd, ['npm', 'install', '--omit=dev', '--no-audit', '--no-fund'], {
          cwd: programs_server_dir,
          stdio: 'inherit'
        }).on('exit', function(code) {
          if(code !== 0) {
            throw new Error(
              'could not install the bundled server dependencies in ' +
              programs_server_dir + ' (exit code ' + code + ')'
            );
          }
          if(done) done();
        });
    };

    //remove write-protect flag on windows
    if (self.$.env.os.is_windows) {
      spawn('attrib', ['-R', join(tmp_dir, '*.*'), '/S', '/D']).on('exit', function() {
        afterBuild();
      });
    } else {
      afterBuild();
    }
  });
};

App.prototype.ensure_deps = function(done) {
  this.log.info('ensuring electrify dependencies');
  var npm_cmd = 'npm' + (this.$.env.os.is_windows ? '.cmd' : '');

  // in development mode, use local electrify version
  if(this.$.env.is_development_mode) {

    // when running tests, avoid re-installing it every time
    var electrify_mod = join(this.$.env.app.root, 'node_modules', this.$.env.name);
    if(this.$.env.is_running_tests && fs.existsSync(electrify_mod)) {
      return setTimeout(done, 1);
    }

    // proceeds and self install itself :P
    this.spawn(npm_cmd, ['i', '--save', join(__dirname, '..')], {
      cwd: this.$.env.app.root,
      stdio: this.$.env.stdio
    }).on('exit', done);

  }
  else {
    // fetch version infos
    var pkg_path    = join(this.$.env.app.root, 'package.json');
    var deps        = require(pkg_path).dependencies || {};
    var pkg_version = deps[this.$.env.name] || deps['electrify-qrl'] || deps.electrify;
    var version     = this.$.env.version;

    // check and warn users about electrify-qrl versions mismatch
    if(pkg_version != version) {
      this.log.warn([
        "{{IMPORTANT}} Your local electrify-qrl npm package must match version",
        version,
        " -- please update it to avoid errors"
      ].join(' '));
    }

    // with a lockfile, install exactly what it describes and nothing else
    var has_lock = fs.existsSync(join(this.$.env.app.root, 'package-lock.json'));
    var npm_args = [has_lock ? 'ci' : 'install', '--no-audit', '--no-fund'];

    this.spawn(npm_cmd, npm_args, {
      cwd: this.$.env.app.root,
      stdio: this.$.env.stdio
    }).on('exit', function(code) {
      if(code !== 0) {
        throw new Error(
          'npm ' + npm_args[0] + ' failed in .electrify with exit code ' + code
        );
      }
      done();
    });
  }
};
