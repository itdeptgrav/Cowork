import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractBody,
  parseAddress,
  parseAddressList,
  parseGmailMessage,
} from "./parse.ts";

/**
 * Gmail's shape → Cowork's.
 *
 * Pure, so it is tested without a network or a credential — the parsing is
 * where the bugs live, not the HTTP.
 */

test("an angled address keeps its display name", () => {
  const p = parseAddress("Maya Ferreira <maya@grav.in>");
  assert.equal(p?.address, "maya@grav.in");
  assert.equal(p?.displayName, "Maya Ferreira");
});

test("a bare address is still a party", () => {
  assert.equal(parseAddress("client@vendor.com")?.address, "client@vendor.com");
});

test("a quoted display name loses its quotes", () => {
  assert.equal(parseAddress('"Ray, R" <ray@grav.in>')?.displayName, "Ray, R");
});

test("a display name containing a comma does not split the list", () => {
  /* Splitting naively on "," is the classic bug here: it turns one recipient
     into two, and the second is not an address. */
  const list = parseAddressList('"Ray, R" <ray@grav.in>, client@vendor.com');
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((p) => p.address), ["ray@grav.in", "client@vendor.com"]);
});

test("nonsense is dropped rather than becoming a party", () => {
  assert.equal(parseAddress("undisclosed-recipients"), null);
  assert.deepEqual(parseAddressList(""), []);
});

test("everything from Gmail is external until the directory says otherwise", () => {
  /* Resolving an address back to an employee happens one layer up, against the
     directory. Guessing here would make a colleague's mail look external. */
  const p = parseAddress("maya@grav.in");
  assert.equal(p?.kind, "external");
  assert.equal(p?.employeeId, null);
});

test("a nested text/plain part is found", () => {
  const body = extractBody({
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/html", body: { data: Buffer.from("<p>no</p>").toString("base64url") } },
      {
        mimeType: "multipart/related",
        parts: [
          { mimeType: "text/plain", body: { data: Buffer.from("the real body").toString("base64url") } },
        ],
      },
    ],
  });
  assert.equal(body, "the real body");
});

test("a whole message maps onto the domain shape", () => {
  const m = parseGmailMessage({
    id: "18c",
    threadId: "t9",
    internalDate: "1769600000000",
    payload: {
      headers: [
        { name: "From", value: "Client <client@vendor.com>" },
        { name: "To", value: "maya@grav.in" },
        { name: "Subject", value: "Quote" },
      ],
      mimeType: "text/plain",
      body: { data: Buffer.from("Attached.").toString("base64url") },
    },
  });
  assert.equal(m.transport, "gmail");
  assert.equal(m.gmailMessageId, "18c");
  assert.equal(m.threadId, "gt-t9");
  assert.equal(m.subject, "Quote");
  assert.equal(m.body, "Attached.");
  assert.equal(m.deliveryError, null);
});

test("a message with no subject says so rather than being blank", () => {
  const m = parseGmailMessage({ id: "1", threadId: "t", payload: { headers: [] } });
  assert.equal(m.subject, "(no subject)");
});
