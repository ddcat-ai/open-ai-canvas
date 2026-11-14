const test = require("node:test");
const assert = require("node:assert/strict");
const { registrationPolicy, registrationInput } = require("../activation/lite-policy");

const settings = (extra = {}) => ({ firstUser: false, registrationEnabled: true, ...extra });
const values = (extra = {}) => ({ username: " alice ", password: "password", acceptedTerms: true, method: "email", email: " Alice@Example.com ", phone: "", ticket: "ticket", emailCode: "123456", smsCode: "654321", ...extra });

test("registration follows loaded first-user, disabled, and verification policies", () => {
    assert.throws(() => registrationPolicy(null), /策略/);
    assert.equal(registrationPolicy(settings({ registrationEnabled: false, emailRegistration: true })).enabled, false);
    assert.deepEqual(registrationPolicy(settings({ firstUser: true })), { enabled: true, methods: [] });
    assert.deepEqual(registrationPolicy(settings({ smsRegistration: true, emailRegistration: true })).methods, ["sms", "email"]);
    assert.deepEqual(registrationPolicy(settings({ smsAndEmailRegistration: true, emailRegistration: true })).methods, ["sms_email"]);
    assert.deepEqual(registrationPolicy(settings({ emailCodeRequired: true })).methods, ["email"]);
    assert.equal(registrationPolicy(settings()).enabled, false);
});

test("registration submits only selected verification fields and requires consent and ticket", () => {
    assert.deepEqual(registrationInput(settings({ emailRegistration: true }), values()), {
        username: "alice", password: "password", acceptedTerms: true, ticket: "ticket", email: "alice@example.com", emailCode: "123456",
    });
    assert.deepEqual(registrationInput(settings({ smsAndEmailRegistration: true }), values({ method: "sms_email", phone: "13800000000" })), {
        username: "alice", password: "password", acceptedTerms: true, ticket: "ticket", email: "alice@example.com", emailCode: "123456", phone: "13800000000", smsCode: "654321",
    });
    assert.throws(() => registrationInput(settings({ emailRegistration: true }), values({ ticket: "" })), /验证码/);
    assert.throws(() => registrationInput(settings({ smsAndEmailRegistration: true }), values({ method: "sms_email", phone: "13800000000", smsCode: "" })), /短信验证码/);
    assert.throws(() => registrationInput(settings({ emailRegistration: true }), values({ acceptedTerms: false })), /同意/);
    assert.throws(() => registrationInput(settings({ smsRegistration: true }), values()), /验证方式/);
    assert.deepEqual(registrationInput(settings({ firstUser: true }), values({ email: "" })), { username: "alice", password: "password", acceptedTerms: true });
});
