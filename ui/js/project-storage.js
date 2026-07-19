(function (global) {
  "use strict";

  const load = (key) => {
    try {
      return JSON.parse(global.localStorage.getItem(key) || "null");
    } catch (error) {
      console.warn("Ignoring invalid GEAR autosave", error);
      return null;
    }
  };

  const save = (key, value) => {
    global.localStorage.setItem(key, JSON.stringify(value));
  };

  global.GearProjectStorage = Object.freeze({ load, save });
})(window);
