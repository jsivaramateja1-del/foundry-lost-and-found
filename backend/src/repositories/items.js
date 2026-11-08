/**
 * Item persistence on PostgreSQL.
 *
 * The Mongo version had to coerce and validate every filter by hand because
 * Express can turn ?category[$ne]=x into an operator. Here every value is a
 * bound parameter, so an object arriving from the query string can only ever be
 * compared as text — the injection class is structurally absent.
 */
const { one, many, db } = require('../config/pg');

const toItem = (row) => row && {
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
  imageUrl: row.image_url,
  verifiedAt: row.verified_at,
  verifiedBy: row.verified_by,
  reportedBy: row.reported_by,
  reporterName: row.reporter_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at
};

const SORTS = {
  newest: 'i.created_at desc',
  oldest: 'i.created_at asc',
  title: 'i.title asc',
  'title-desc': 'i.title desc'
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
                      image_url=$10
      where id=$1 returning *`,
    [id, data.title, data.description, data.category, data.subcategory, data.customCategory,
     data.location, data.customLocation, data.date, data.imageUrl]));

const setStatus = async (id, status) =>
  toItem(await one('update items set status=$2 where id=$1 returning *', [id, status]));

const verify = async (id, adminId) =>
  toItem(await one(
    `update items set verified_at = now(), verified_by = $2 where id = $1 returning *`,
    [id, adminId]));

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

/** Listings that look like this one — same category, opposite type, still open. */
const similar = async (item, limit = 5) =>
  (await many(
    `select ${COLUMNS} from items i join users u on u.id = i.reported_by
      where i.category = $1 and i.type <> $2 and i.status = 'open' and i.id <> $3
      order by i.created_at desc limit $4`,
    [item.category, item.type, item.id, limit])).map(toItem);

module.exports = {
  toItem, list, findById, findByIdRaw, create, update, setStatus, verify, remove,
  stats, similar, buildFilter, db
};
