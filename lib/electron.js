var _        = require('lodash');
var fs       = require('fs-extra');
var path     = require('path');
var join     = path.join;
var shell    = require('shelljs');

module.exports = function($){
  return new Electron($);
};

function Electron($){
  this.$ = $;
  this.log = require('./log')($, 'electrify:electron');
}

Electron.prototype.package = function(packager_options, done) {
  var packager = require('electron-packager');
  var electronVersion = "1.8.4";

  // app name require('.electrify/package.json').name
  var packageJson = require(join(this.$.env.app.root, 'package.json'));
  var name = packageJson.name;

  this.log.info(
    'packaging "'+ name +'" for platform '+ this.$.env.sys.platform + '-' +
     this.$.env.sys.arch + ' using electron v' + electronVersion
  );

  // temp dir for packaging the app
  var tmp_package_dir = join(this.$.env.core.tmp, 'package');

  shell.rm('-rf', tmp_package_dir);
  shell.mkdir('-p', tmp_package_dir);

  var args = {
    name: require(join(this.$.env.app.root, 'package.json')).name,
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
    args.afterCopy = [
      // Fix local paths after moving app to temp folder
      function(buildPath, electronVersion, platform, arch, callback) {
        var localElectrifyPath = join(__dirname, '..');
        var packageJsonPath = join(buildPath, 'package.json');
        var packageJson = require(packageJsonPath);

        packageJson.dependencies['electrify-qrl'] = 'file://' + localElectrifyPath;
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

        var electrifyNodeModulesPath = join(buildPath, 'node_modules', 'electrify-qrl');
        if (fs.lstatSync(electrifyNodeModulesPath).isSymbolicLink()) {
          // split rm and ln because ln -sf does not work with shellfs@0.7.8
          shell.rm(electrifyNodeModulesPath);
          shell.ln('-s', localElectrifyPath, electrifyNodeModulesPath);
        }

        // with npm5 update the package-lock.json that also contains the relative path
        var packageLockPath = join(buildPath, 'package-lock.json');
        if (fs.existsSync(packageLockPath)) {
          var packageLockJson = require(packageLockPath);
          packageLockJson.dependencies['electrify-qrl'].version = 'file://' + localElectrifyPath;
          fs.writeFileSync(packageLockPath, JSON.stringify(packageLockJson, null, 2));
        }

        callback();
      }
    ];
  }

  _.extend(args, packager_options);

  var self = this;
  packager(args, function(err) {
    if(err) throw err;
    
     // moving packaged app to .dist folder
    shell.rm('-rf', self.$.env.app.dist);
    fs.moveSync(tmp_package_dir, self.$.env.app.dist);
    self.log.info('wrote new app to ', self.$.env.app.dist);

    if(done) done();
  });
};
