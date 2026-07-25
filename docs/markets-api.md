# Markets API

## `GET /api/markets`

Returns a cursor-paginated list of non-archived markets, ordered by newest first
(`createdAt DESC, id DESC`).

### Query Parameters

| Parameter | Type   | Required | Default | Constraints | Description                                                   |
|-----------|--------|----------|---------|-------------|---------------------------------------------------------------|
| `limit`   | number | no       | `20`    | 1-100       | Number of rows to return per page.                            |
| `cursor`  | string | no       | --      | opaque token| Cursor from the previous page's `nextCursor`. Absent = page 1.|
| `status`  | string | no       | --      | free text   | Filter by market status.                                      |
| `category`| string | no       | --      | free text   | Filter by market category.                                    |
| `tag`     | string | no       | --      | free text   | Filter by market tag.                                         |
| `sort`    | string | no       | --      | free text   | Sort column.                                                  |
| `order`   | string | no       | --      | `asc`/`desc`| Sort direction.                                               |

### Pagination

This endpoint uses **keyset (cursor) pagination** on `(createdAt DESC, id DESC)`.

- Pass the returned `nextCursor` verbatim as `?cursor=` to fetch the next page.
- `nextCursor` is `null` on the last page.
- Cursors are versioned. A stale or tampered cursor is safely ignored (the
  response restarts from page 1) rather than causing a 500 or a wrong offset.

### Response

`200 OK`

```json
{
  "data": [
    {
      "id": "market-1",
      "question": "Will BTC close above $100k this quarter?",
      "status": "active",
      "resolutionTime": "2026-07-01T00:00:00.000Z"
    }
  ],
  "nextCursor": "djF8MjR8..."
}
```

### Errors

- `400 validation_error` - invalid query parameters

## `GET /api/markets/recommendations`

Returns personalized market recommendations for the authenticated user.

### Authentication

Requires a bearer JWT accepted by the standard authentication middleware.

```http
Authorization: Bearer <token>
```

### Response

`200 OK`

```json
{
  "data": [
    {
      "id": "market-1",
      "question": "Will BTC close above $100k this quarter?",
      "status": "active",
      "resolutionTime": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

The endpoint excludes markets the user has already predicted on, prefers active
non-archived markets related to terms from the user's prediction history, and
falls back to recent active non-archived markets when there is no usable history
or no related market is found.

### ETag support

`GET /api/markets` supports conditional revalidation through `ETag` and `If-None-Match`.
On a matching revalidation request, the route responds with `304 Not Modified`
and does not return a response body. Clients should treat the response as a
cache revalidation success and reuse the previously cached representation.

### Conditional requests and caching

The public market listing endpoint supports strong ETags. Clients may send an
`If-None-Match` header with the latest ETag to receive a `304 Not Modified`
response without a body when the market list has not changed.

Example:

```http
GET /api/markets
If-None-Match: "<etag>"
```

### Errors

- `401 Unauthorized` when the bearer token is missing, malformed, invalid, or
  belongs to no known user.
