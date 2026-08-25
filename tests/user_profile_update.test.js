const test = require("node:test");
const assert = require("node:assert/strict");
const fsNode = require("node:fs");
const path = require("node:path");
const ejs = require("ejs");
const User = require("../models/User");

test("User model supports firstName and lastName fields", () => {
  const user = new User({
    name: "Alex Morgan",
    firstName: "Alex",
    lastName: "Morgan",
    email: "alex@example.com",
    passwordHash: "dummyhash"
  });

  assert.equal(user.name, "Alex Morgan");
  assert.equal(user.firstName, "Alex");
  assert.equal(user.lastName, "Morgan");
  assert.equal(user.validateSync(), undefined);
});

test("views/account.ejs renders First Name and Last Name inputs", async () => {
  const templatePath = path.join(__dirname, "../views/account.ejs");
  const template = fsNode.readFileSync(templatePath, "utf8");

  const rendered = ejs.render(template, {
    title: "Account Settings",
    appName: "Moyi-CMO",
    canonicalUrl: "https://moyi-cmo.com/account",
    currentPath: "/account",
    currentUser: {
      _id: "user_123",
      name: "Sarah Connor",
      firstName: "Sarah",
      lastName: "Connor",
      email: "sarah@skynet.com",
      subscriptionStatus: "active"
    },
    plan: { name: "Pro Plan" },
    accountMessage: "",
    accountError: "",
    auditLogs: [],
    apiCredentials: [],
    apiProjects: [],
    apiScopes: [],
    oneTimeApiKey: ""
  }, {
    filename: templatePath,
    root: path.join(__dirname, "../views")
  });

  assert.match(rendered, /name="firstName"/);
  assert.match(rendered, /name="lastName"/);
  assert.match(rendered, /value="Sarah"/);
  assert.match(rendered, /value="Connor"/);
  assert.match(rendered, /action="\/account\/profile"/);
});
