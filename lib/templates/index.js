const { app, BrowserWindow } = require('electron');
const electrify = require('electrify-qrl')(__dirname);

let window;

app.on('ready', function() {

  // electrify start
  electrify.start(function(meteor_root_url) {

    // creates a new electron window
    window = new BrowserWindow({
      width: 1200, height: 900,
      nodeIntegration: false // node integration must to be off
    });

    // open up meteor root url
    window.loadURL(meteor_root_url);
  });
});

app.on('will-quit', function terminate_and_quit(event) {
  
  // if electrify is up, cancel exiting with `preventDefault`,
  // so we can terminate electrify gracefully without leaving child
  // processes hanging in background
  if(electrify.isup() && event) {

    // holds electron termination
    event.preventDefault();

    // gracefully stops electrify 
    electrify.stop(function(){

      // and then finally quit app
      app.quit();
    });
  }
});


// Defining Methods on the Electron side
//
// electrify.methods({
//   'method.name': function(name, done) {
//     // do things... and call done(err, arg1, ..., argN)
//     done(null);
//   }
// });
//
// =============================================================================
// Created methods can be called seamlessly with help of the
// meteor-electrify-client package from your Meteor's
// client and server code, using:
// 
//    Electrify.call('methodname', [..args..], callback);
// 
// ATTENTION:
//    From meteor, you can only call these methods after electrify is fully
//    started, use the Electrify.startup() convenience method for this
//
// Electrify.startup(function(){
//   Electrify.call(...);
// });
// 
// =============================================================================