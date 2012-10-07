module.exports.instantiate = function() {
  return function(req, res, next) {
    if (!req.session || (req.session.userId == null)) {
      // FIXME return a ClientState 
      req.state = new ClientState(null,req.method);
      req.state.init(function() {
        next();
      });
    }
    else {
      // find the right state in redis
      req.state = new ClientState(req.session.userId,req.method);
      req.state.fetch(function() {
        next();
      });
    }
  };
};
