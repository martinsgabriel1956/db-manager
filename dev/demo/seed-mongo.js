// MongoDB demo: ObjectId, Date, Int32 vs Int64 (one beyond 2^53), Decimal128,
// Binary, nested documents and arrays, a view and a larger collection.
db = db.getSiblingDB("shop");

db.customers.insertMany([
  {
    _id: ObjectId("65a1b2c3d4e5f60718293a4b"),
    name: "Ana Souza",
    email: "ana@example.com",
    visits: NumberLong("9007199254740993"),
    age: 34,
    balance: NumberDecimal("1234.5678"),
    vip: true,
    tags: ["early-adopter", "vip"],
    address: { city: "São Paulo", zip: "01310-100", geo: { lat: -23.56, lng: -46.65 } },
    avatar: BinData(0, "iVBORw0KGgo="),
    createdAt: ISODate("2024-01-15T13:30:00Z")
  },
  {
    name: "Bruno Lima",
    email: "bruno@example.com",
    visits: NumberLong(2),
    age: 41,
    tags: [],
    createdAt: new Date()
  },
  {
    name: "Diego O'Brien",
    email: "diego@example.com",
    visits: NumberLong(0),
    notes: null,
    createdAt: ISODate("2000-02-29T00:00:00Z")
  }
]);
db.customers.createIndex({ email: 1 }, { unique: true });

const statuses = ["pending", "paid", "shipped", "cancelled"];
const orders = [];
for (let n = 1; n <= 2000; n++) {
  orders.push({
    number: n,
    customer: ["Ana Souza", "Bruno Lima", "Diego O'Brien"][n % 3],
    status: statuses[n % 4],
    total: NumberDecimal(((n % 50) * 9.9).toFixed(2)),
    items: [{ sku: "SKU-" + (n % 7), quantity: 1 + (n % 3) }],
    placedAt: new Date(Date.UTC(2024, 5, 1) + n * 60000)
  });
}
db.orders.insertMany(orders);
db.orders.createIndex({ status: 1, placedAt: -1 });

db.createView("paid_orders", "orders", [{ $match: { status: "paid" } }]);

const events = [];
for (let n = 1; n <= 50000; n++) {
  events.push({
    _id: n,
    kind: ["click", "view", "purchase"][n % 3],
    value: n % 10 === 0 ? null : n * 0.5
  });
}
db.events.insertMany(events);
