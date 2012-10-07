var redis = require('redis')
    , jsonify = require('redis-jsonify')
    , redisclient = jsonify(redis.createClient())
    ,_ = require('underscore')._;

var DEBUGREDISSTATEMACHINE = false;

debuglog = function(str) {
  if (DEBUGREDISSTATEMACHINE) console.log(str);
};


ModuleState = function(name,defaults) {
  this.name = name;
  this.transitions = {};
  this.state = defaults; // should be a {}
};

// make a state object
// type is 'success' or 'error'
ModuleState.prototype.addTransition = function(req_method,type,params) {
  if (type != 'success' && type != 'error') throw "Unsupported transition type " + type;
  if (!this.transitions[req_method]) this.transitions[req_method] = {success:{},error:{}};
  this.transitions[req_method][type] = params;
}


// To run the transition without overwriting the 
// module state (perhaps when using a global 
//  ModuleState instance) pass false for overwrite 
//  and the state parameters for oldparams
ModuleState.prototype.runTransition = function(req_method,type,overwrite,oldparams) {
  // run the transition for this rpc name
  if (!this.transitions[req_method] || !this.transitions[req_method][type]) {
    debuglog("No transitions for "+this.name+": "+req_method+": "+type);
    //return false;
    return (overwrite) ? this.state : oldparams;
  }
  if (overwrite) {
    debuglog("Overwriting state with transitions for "+this.name+": "+req_method+": "+type);
    return _.extend(this.state,this.transitions[req_method][type]);
  } else {
    debuglog("Not overwriting state with transitions for "+this.name+": "+req_method+": "+type);
    return _.extend({},oldparams,this.transitions[req_method][type]);
  }
};

exports.init = function(state_defaults_file) {
  // now apply to the state defaults
  var state_defaults = require(state_defaults_file);
  
  global.ModuleStates = {};
  
  // add transition objects to the defaults
  _.each(state_defaults,function(e,i) {
    global.ModuleStates[i] = new ModuleState(i,e.state);
    _.each(e.transitions,function(e2,i2) {
      _.each(e2,function(e3,i3) {
        global.ModuleStates[i].addTransition(i2,i3,e3);
      });
    });
  });
};

exports.setDebug= function(d) {
  DEBUGREDISSTATEMACHINE = d;
};

// create a prototype for the state object
global.ClientState = function (identifier,current_method) {
  this.setIdentifier(identifier);
  this.modules = {}; // data retrieved by redis or init'd
  this.current_method = current_method;
}
ClientState.prototype.setIdentifier = function(identifier) {
  this.id = identifier; // Typically userID
  if (this.id) {
    this.redisStateId = "state:"+this.id; // for redis
    this.frozen = false;
  } else {
    this.frozen = true;
  }
};
 
// FIXME think about multiple clients using same userId//  and asynchronous issues therein!
// ONE POSSIBLE FIX: Don't allow clients to save(). 
// Instead, all save() invocations come
// from server-side actions.
ClientState.prototype.save = function(cb) {
  if (this.frozen) throw "Cannot save state because identifier is frozen";
  var cs = this;
  return redisclient.set(this.redisStateId,this.modules,function(err,result) {
    if (err) {
      // log this error, report the problem
      debuglog("State save error: "+err);
    }
    else {
      if (cb) cb(cs);
    }
  });
};
// fetch calls cb(this) upon success
ClientState.prototype.fetch = function(cb) {
  if (this.frozen) throw "Cannot fetch state because identifier is frozen";
  var cs = this;
  redisclient.get(this.redisStateId, function(err,result) {
    if (err) {
       // make one!
       debuglog("There was an error in fetching " + cs.redisStateId + " values");
       cs.init(cb);
    }
    else if (!result || result == "undefined" || result == undefined) {
      // find out why the result didn't return without error!
      debuglog("Null result returned without error for "+ cs.redisStateId);
      cs.init(cb); // TODO make the state!
    }
    else {
      debuglog("The result from the fetch was " + result);
      cs.modules = result;
      cb(cs);
    }
  });
}; 
ClientState.prototype.init = function(cb) {
  debuglog("entering init");
  // get defaults from ModuleState global and save them in redis
  var that = this;
  _.each(ModuleStates,function(e,i) {
    that.modules[e.name] = e.state;
  });
  if (!this.frozen) this.save(cb);
  else {
    debuglog("Could not save state upon init because it is frozen. Suspect session is not authenticated");
    if (cb) cb();
  }
};

// for now, find out what the request is.
// this will determine what state transitions are called
// state transitions are defined as
//   1) request name (e.g. authenticate, or logout, or sendMessage)
//   2) Whether this is a 'success' or a 'error' state transition
//   3) list of
//     a) state object name to be updated
//     b) property list of parameters to be set OR appended (the latter needs to be figured out)

ClientState.prototype.success = function(cb) {
  // call success transition on all ModuleStates with a corresponding req.method 'success' transition
  var that = this;
  _.each(ModuleStates,function(e,i) {
    that.modules[e.name] = e.runTransition(that.current_method,'success',false,that[e.name]);
    debuglog("Module state for " + e.name);
    debuglog(that.modules[e.name]);
  });
  if (!this.frozen) this.save(cb);
  else {
    debuglog("Could not save state upon success because it is frozen. Suspect session is not authenticated");
    if (cb) cb();
  }
};

ClientState.prototype.error = function(cb) {
  // call success transition on all ModuleStates with a corresponding req.method 'error' transition
  var that = this;
  _.each(ModuleStates,function(e,i) {
    that.modules[e.name] = e.runTransition(that.current_method,'error',false,that[e.name]);
  });
  if (!this.frozen) this.save(cb);
  else {
    debuglog("Could not save state upon error because it is frozen. Suspect session is not authenticated");
    if (cb) cb();
  }
};
