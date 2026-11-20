var _        = require('lodash');
var fs       = require('fs-extra');
var path     = require('path');
var join     = path.join;

module.exports = function($){
  return new Electron($);
};

function Electron($){
  this.$ = $;
  this.log = require('./log')($, 'electrify:electron');
}

// the electron version to package is the one the app itself depends on: the
// version actually installed in `.electrify/node_modules`, or failing that the
// one declared in `.electrify/package.json`
Electron.prototype.version = function() {
  var root = this.$.env.app.root;

  var installed = join(root, 'node_modules', 'electron', 'package.json');
  if(fs.existsSync(installed))
    return fs.readJsonSync(installed).version;

  var deps = fs.readJsonSync(join(root, 'package.json')).dependencies || {};
  var spec = (deps.electron || '').replace(/^[^0-9]*/, '');
  if(/^\d+\.\d+\.\d+/.test(spec))
    return spec;

  throw new Error(
    'cannot tell which electron version to package: install `electron` ' +
    'inside ' + root + ' (npm install --save-exact electron)'
  );
};

Electron.prototype.package = function(packager_options, done) {
  var electronVersion = this.version();

  // app name require('.electrify/package.json').name
  var packageJson = fs.readJsonSync(join(this.$.env.app.root, 'package.json'));
  var name = packageJson.name;

  this.log.info(
    'packaging "'+ name +'" for platform '+ this.$.env.sys.platform + '-' +
     this.$.env.sys.arch + ' using electron v' + electronVersion
  );

  // temp dir for packaging the app
  var tmp_package_dir = join(this.$.env.core.tmp, 'package');
  this.log.info('packaging to ' + tmp_package_dir + ' if things go missing...');
  fs.removeSync(tmp_package_dir);
  fs.ensureDirSync(tmp_package_dir);

  var args = {
    name: name,
    electronVersion: electronVersion,
    arch: this.$.env.sys.arch,
    platform: this.$.env.sys.platform,
    dir: this.$.env.app.root,
    out: tmp_package_dir,
    tmpdir: false,
    asar: false
  };

  //add optional parts of package.json
  if (packageJson.version) {
    args.appVersion = packageJson.version;
  }
  if (packageJson.electronPackager) {
    // icon
    var icon = packageJson.electronPackager.icon;
    if (icon) {
      var iconPath;
      if (typeof icon === 'string') {
        iconPath = icon;
      } else if (typeof icon === 'object' && icon[this.$.env.sys.platform]) {
        iconPath = icon[this.$.env.sys.platform];
      }

      if (iconPath) {
        if (!path.isAbsolute(iconPath)) {
          iconPath = path.resolve(this.$.env.app.root, iconPath);
        }
        if (fs.existsSync(iconPath)) {
          args.icon = iconPath;
        }
      }

      delete packageJson.electronPackager.icon;
    }

    _.extend(args, packageJson.electronPackager);
  }

  if (this.$.env.is_development_mode) {
    var electrify_name = this.$.env.name;
    args.afterCopy = [
      function(hook) {
        // Fix local paths after moving app to temp folder
        var localElectrifyPath = join(__dirname, '..');
        var packageJsonPath = join(hook.buildPath, 'package.json');
        var packageJson = fs.readJsonSync(packageJsonPath);

        packageJson.dependencies[electrify_name] = 'file://' + localElectrifyPath;
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

        var electrifyNodeModulesPath = join(hook.buildPath, 'node_modules', electrify_name);
        if (fs.lstatSync(electrifyNodeModulesPath).isSymbolicLink()) {
          fs.removeSync(electrifyNodeModulesPath);
          fs.symlinkSync(localElectrifyPath, electrifyNodeModulesPath);
        }
      }
    ];
  }

  Object.assign(args, packager_options);

  // npm prune stalls on windows runners, so it is opt-in there
  if (this.$.env.sys.platform === 'win32' && typeof args.prune === 'undefined') {
    args.prune = false;
  }
  // keep the packaging log visible
  if (typeof args.quiet === 'undefined') {
    args.quiet = false;
  }

  var self = this;

  // @electron/packager is an es module, and is only needed here -- an
  // electrified app requires this file at runtime but never packages itself
  import('@electron/packager').then(function(mod) {
    return mod.packager(args);
  }).then(function() {

    // moving packaged app to .dist folder
    fs.removeSync(self.$.env.app.dist);
    fs.moveSync(tmp_package_dir, self.$.env.app.dist);
    self.log.info('wrote new app to ', self.$.env.app.dist);

    if(done) done();

  }).catch(function(err) {
    // fail loudly, with a non-zero exit code
    process.nextTick(function(){ throw err; });
  });
};
