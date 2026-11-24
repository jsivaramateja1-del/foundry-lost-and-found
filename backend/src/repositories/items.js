/**
 * Item persistence on PostgreSQL.
 *
 * The Mongo version had to coerce and validate every filter by hand because
 * Express can turn ?category[$ne]=x into an operator. Here every value is a
 * bound parameter, so an object arriving from the query string can only ever be
 * compared as text — the injection class is structurally absent.
 */
const { one, many, db } = require('../config/pg');

const toItem = (row) => (row ? {
  id: row.id,
  title: row.title,
  description: row.description,
  category: row.category,
  subcategory: row.subcategory,
  customCategory: row.custom_category,
  location: row.location,
  customLocation: row.custom_location,
  date: row.date,
  type: row.type,
  status: row.status,
  /* Once an item is returned, its photo stops being public. The listing stays
     visible for the record, but a picture of someone's property is no longer
     needed by anyone browsing, and keeping it up invites it to be scraped. */
  imageUrl: row.status === 'returned' ? null : row.image_url,
  verifiedAt: row.verified_at,
  verifiedBy: row.verified_by,
  reportedBy: row.reported_by,
  reporterName: row.reporter_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at
} : null);

/**
 * Public shape of a listing.
 *
 * `reportedBy` is the reporter's internal user UUID. Publishing it on a public,
 * unauthenticated endpoint lets anyone correlate every listing by one person —
 * "show me everything this student posted" — which is not information the board
 * needs to function. `reporterName` stays, because the detail dialog shows who
 * posted it and that is deliberate product behaviour.
 *
 * The owner still needs to know which listings are theirs, so the id is added
 * back only on the detail route, and only when the caller is authenticated as
 * that user (see GET /api/items/:id).
 */
const toPublicItem = (item) => {
  if (!item) return null;
  const { reportedBy, ...rest } = item;
  return rest;
};

// Every sort ends in i.id so LIMIT/OFFSET is deterministic. The seed inserts all
// rows in one transaction and now() is transaction-scoped, so equal created_at
// values are normal — without a tie-breaker a row can appear on two pages or none.
const SORTS = {
  newest: 'i.created_at desc, i.id desc',
  oldest: 'i.created_at asc, i.id asc',
  title: 'i.title asc, i.id asc',
  'title-desc': 'i.title desc, i.id asc'
};

const COLUMNS = `i.*, u.name as reporter_name`;

/**
 * Builds the WHERE clause from a validated filter object.
 * Returns { where, params } — never string-interpolates a value.
 */
const buildFilter = (f = {}) => {
  const clauses = [];
  const params = [];
  const add = (sql, value) => { params.push(value); clauses.push(sql.replace('$?', `$${params.length}`)); };

  // Hidden listings are never part of the public board unless asked for.
  if (!f.includeHidden) clauses.push("i.status <> 'hidden'");
  /* Returned items have their own page. Unless a status is asked for
     explicitly, the board shows only what can still be acted on. */
  if (!f.status) clauses.push("i.status <> 'returned'");
  if (f.type) add('i.type = $?', f.type);
  if (f.category) add('i.category = $?', f.category);
  if (f.subcategory) add('i.subcategory = $?', f.subcategory);
  if (f.location) add('i.location = $?', f.location);
  if (f.status) add('i.status = $?', f.status);
  if (f.reportedBy) add('i.reported_by = $?', f.reportedBy);
  if (f.from) add('i.date >= $?', f.from);
  if (f.to) add('i.date <= $?', f.to);
  if (f.q) add("to_tsvector('simple', i.title || ' ' || i.description) @@ plainto_tsquery('simple', $?)", f.q);

  return { where: clauses.length ? `where ${clauses.join(' and ')}` : '', params };
};

const list = async (filter, { page = 1, limit = 12, sort = 'newest' } = {}) => {
  const { where, params } = buildFilter(filter);
  const order = SORTS[sort] || SORTS.newest;
  const offset = (page - 1) * limit;

  const totalRow = await one(`select count(*)::int as total from items i ${where}`, params);
  const rows = await many(
    `select ${COLUMNS} from items i
       join users u on u.id = i.reported_by
       ${where}
       order by ${order}
       limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset]
  );
  return { total: totalRow.total, items: rows.map(toItem) };
};

const findById = async (id, { includeHidden = false } = {}) => {
  const row = await one(
    `select ${COLUMNS} from items i join users u on u.id = i.reported_by
      where i.id = $1 ${includeHidden ? '' : "and i.status <> 'hidden'"}`, [id]);
  return toItem(row);
};

const findByIdRaw = async (id) =>
  toItem(await one('select * from items where id = $1', [id]));

const create = async (data) =>
  toItem(await one(
    `insert into items (title, description, category, subcategory, custom_category,
                        location, custom_location, date, type, status, image_url, reported_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$11)
     returning *`,
    [data.title, data.description, data.category, data.subcategory, data.customCategory,
     data.location, data.customLocation, data.date, data.type, data.imageUrl, data.reportedBy]));

const update = async (id, data) =>
  toItem(await one(
    `update items set title=$2, description=$3, category=$4, subcategory=$5,
                      custom_category=$6, location=$7, custom_location=$8, date=$9,
                      image_url=$10, type=$11
      where id=$1 returning *`,
    [id, data.title, data.description, data.category, data.subcategory, data.customCategory,
     data.location, data.customLocation, data.date, data.imageUrl, data.type]));

const setStatus = async (id, status) =>
  toItem(await one('update items set status=$2 where id=$1 returning *', [id, status]));

/**
 * Mark a listing verified.
 *
 * Takes an optional transaction client so "verified" and "points credited" can
 * be one atomic step; otherwise a failure between them leaves a verified
 * listing whose reporter was never credited.
 */
const verify = async (id, adminId, client) => {
  const run = client
    ? (text, params) => client.query(text, params).then((r) => r.rows[0])
    : one;
  return toItem(await run(
    `update items set verified_at = now(), verified_by = $2
      where id = $1 and verified_at is null returning *`,
    [id, adminId]));
};

const remove = async (id) =>
  one('delete from items where id = $1 returning id', [id]);

/** Counts for the public tiles, all under the same visibility rule. */
const stats = async () => {
  const row = await one(`
    select
      count(*)::int as total,
      count(*) filter (where type='lost')::int as lost,
      count(*) filter (where type='found')::int as found,
      count(*) filter (where status='returned')::int as returned,
      count(*) filter (where status='claimed')::int as claimed,
      count(*) filter (where status='open')::int as active
    from items where status <> 'hidden'`);
  return row;
};

/**
 * Listings that look like this one.
 *
 * Matching on category alone is too loose: every lost Electronics item matched
 * every found Electronics item, so a headset was offered a calculator as a
 * "possible match". Require a shared meaningful word as well.
 */
const similar = async (item, limit = 5) => {
  const stop = new Set(['the', 'a', 'an', 'my', 'and', 'with', 'of', 'in', 'on',
    'for', 'black', 'blue', 'new', 'size', 'old', 'white', 'red']);
  const words = String(item.title || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !stop.has(w));

  // Nothing distinctive in the title: better to show no matches than bad ones
  if (!words.length) return [];

  const patterns = words.map((w) => `%${w}%`);

  return (await many(
    `select ${COLUMNS} from items i join users u on u.id = i.reported_by
      where i.category = $1 and i.type <> $2 and i.status = 'open' and i.id <> $3
        and (i.title ilike any($4::text[]) or i.description ilike any($4::text[]))
      order by i.created_at desc limit $5`,
    [item.category, item.type, item.id, patterns, limit])).map(toItem);
};

module.exports = {
  toItem,
  toPublicItem,
  list,
  findById,
  findByIdRaw,
  create,
  update,
  setStatus,
  verify,
  remove,
  stats,
  similar,
  buildFilter,
  db,
};
