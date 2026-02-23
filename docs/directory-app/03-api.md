# REST API Design

Base URL: `/v1`
Auth: Bearer JWT
Response envelope (recommended):
- success: `{ "data": ... }`
- error: `{ "error": { "code": "...", "message": "...", "details": {...} } }`

## Standard error codes

- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `POLICIES_NOT_ACCEPTED` (403)
- `VALIDATION_ERROR` (422)
- `NOT_FOUND` (404)
- `CONFLICT` (409)
- `RATE_LIMITED` (429)
- `INTERNAL_ERROR` (500)

## 1) Auth

### POST `/auth/signup`
Auth: no

Request:
```json
{
  "email": "user@example.com",
  "password": "StrongPass123!",
  "first_name": "Ana",
  "last_name": "Kola",
  "country_of_origin": "Albania",
  "age": 29,
  "screen_name": "ana-k",
  "profile_image_url": "https://..."
}
```

Response:
```json
{
  "data": {
    "user_id": "uuid",
    "email_verification_required": true
  }
}
```

### POST `/auth/verify-email`
Auth: no

Request:
```json
{ "token": "email-verification-token" }
```

Response:
```json
{ "data": { "verified": true } }
```

### POST `/auth/login`
Auth: no

Request:
```json
{ "email": "user@example.com", "password": "StrongPass123!" }
```

Response:
```json
{
  "data": {
    "access_token": "jwt",
    "refresh_token": "jwt",
    "user": {
      "id": "uuid",
      "role": "consumer",
      "language_preference": "en",
      "policies": {
        "current_version": "2026-02-17",
        "accepted_version": null,
        "accepted": false
      }
    }
  }
}
```

### POST `/auth/logout`
Auth: yes

Response:
```json
{ "data": { "ok": true } }
```

### POST `/auth/password-reset/request`
Auth: no

Request:
```json
{ "email": "user@example.com" }
```

Response:
```json
{ "data": { "sent": true } }
```

### POST `/auth/password-reset/confirm`
Auth: no

Request:
```json
{ "token": "reset-token", "new_password": "NewStrongPass123!" }
```

Response:
```json
{ "data": { "updated": true } }
```

## 2) Policies and i18n

### GET `/i18n/languages`
Auth: no

Response:
```json
{
  "data": {
    "supported": ["en", "es", "fr", "sq", "el", "it"],
    "fallback": "en",
    "extendable": true
  }
}
```

### PUT `/users/me/language`
Auth: yes

Request:
```json
{ "language": "sq" }
```

Response:
```json
{ "data": { "language_preference": "sq" } }
```

### POST `/users/me/policies/accept`
Auth: yes

Request:
```json
{
  "policies_version": "2026-02-17",
  "accepted_via": "pre_post",
  "checkboxes": {
    "firsthand_only": true,
    "professional_no_hate": true,
    "moderation_understood": true
  }
}
```

Response:
```json
{
  "data": {
    "accepted": true,
    "policies_version": "2026-02-17",
    "policies_accepted_at": "2026-02-17T12:00:00Z"
  }
}
```

## 3) Directory

### GET `/categories`
Auth: no

Response:
```json
{ "data": [{ "id": "uuid", "slug": "restaurant", "label_i18n_key": "category.restaurant" }] }
```

### GET `/businesses`
Auth: no
Query params:
- `q` (name search)
- `category`
- `country`, `region`, `city`
- `sort` (`top_rated|most_reviewed|newest|name`)
- `page`, `page_size`

Response:
```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "Example Business",
        "categories": ["restaurant"],
        "locations_count": 3,
        "scores": {
          "weighted_overall_display": 4.5,
          "weighted_overall_raw": 4.43,
          "unweighted_overall_display": 4.0,
          "business_rating_count": 128
        }
      }
    ],
    "page": 1,
    "page_size": 20,
    "total": 240
  }
}
```

### GET `/businesses/{businessId}`
Auth: no

Response includes business profile + location list + score summary.

### GET `/locations/{locationId}`
Auth: no

Response includes:
- location profile
- factor averages
- secondary averages
- rating distribution (0..5 by 0.5 bins)
- paginated comments + business replies

## 4) Ratings and comments

### PUT `/locations/{locationId}/ratings/me`
Create or update current user's single rating for this location.
Auth: yes

Policies gate:
- if not accepted => `403 POLICIES_NOT_ACCEPTED`

Request:
```json
{
  "factors": {
    "pricing_transparency": 4.5,
    "friendliness": 5.0,
    "lgbtq_acceptance": 4.0,
    "racial_tolerance": 4.5,
    "religious_tolerance": 4.5,
    "accessibility_friendliness": 3.5,
    "cleanliness": 4.0
  },
  "secondary": {
    "pricing_value": 4.0,
    "child_care_availability": 2.5,
    "child_friendliness": 3.5,
    "party_size_accommodations": 4.0,
    "accessibility_details_score": 3.5,
    "accessibility_notes": "Ramp at rear entrance."
  }
}
```

Response:
```json
{
  "data": {
    "rating_id": "uuid",
    "overall_score_raw": 4.29,
    "overall_score_display": 4.5,
    "updated_at": "2026-02-17T12:00:00Z"
  }
}
```

### POST `/ratings/{ratingId}/comment`
Auth: yes

Rules:
- minimum 10 words (server counts words)
- one comment per rating (update via PATCH)

Request:
```json
{
  "content": "I visited in January 2026 and staff explained pricing clearly and respectfully.",
  "visit_month": 1,
  "visit_year": 2026
}
```

Response:
```json
{ "data": { "comment_id": "uuid", "status": "approved" } }
```

### PATCH `/comments/{commentId}`
Auth: yes (owner)

Rule:
- editable for 30 days from `created_at`

### DELETE `/comments/{commentId}`
Auth: yes (owner)

Rule:
- deletable for 30 days
- after 30 days return `403` with code `DELETE_WINDOW_EXPIRED`

### POST `/comments/{commentId}/removal-request`
Auth: yes (owner)

Creates moderation request for >30-day content.

## 5) Business actions

### POST `/businesses`
Auth: yes (`business_owner|admin`)

Policies gate required.

Request includes business profile fields.

### POST `/businesses/{businessId}/locations`
Auth: yes (business owner)

Request includes location fields.

### POST `/comments/{commentId}/business-reply`
Auth: yes (business owner for linked business)

Request:
```json
{ "content": "Thank you for your feedback. We have updated signage and training this month." }
```

Response:
```json
{ "data": { "reply_id": "uuid", "status": "approved" } }
```

### POST `/appeals`
Auth: yes (business owner)

Request:
```json
{
  "target_type": "location",
  "target_location_id": "uuid",
  "reason": "Wrong location",
  "details": "The comment references another branch with similar name."
}
```

Response:
```json
{ "data": { "appeal_id": "uuid", "status": "submitted" } }
```

## 6) Appeals

### GET `/businesses/{businessId}/appeals`
Auth: yes (business owner/admin)

### PATCH `/admin/appeals/{appealId}`
Auth: yes (`moderator|admin`)

Request:
```json
{
  "status": "resolved",
  "admin_decision_notes": "Removed incorrect comment and notified reviewer."
}
```

## 7) Admin moderation

### GET `/admin/moderation/queue`
Auth: yes (`moderator|admin`)
Query:
- `status` (`pending|flagged|all`)
- `type` (`rating|comment|business_reply`)

### POST `/admin/moderation/{type}/{id}/approve`
### POST `/admin/moderation/{type}/{id}/deny`
### POST `/admin/moderation/{type}/{id}/remove`
Auth: yes (`moderator|admin`)

Each action writes `moderation_actions` + `audit_log`.

### POST `/admin/users/{userId}/suspend`
### POST `/admin/businesses/{businessId}/suspend`
Auth: yes (`admin`)

### POST `/admin/roles/assign`
Auth: yes (`admin`)

Request:
```json
{ "user_id": "uuid", "role": "moderator" }
```

### POST `/admin/policies/version`
Auth: yes (`admin`)

Request:
```json
{ "policies_version": "2026-02-17" }
```

Response:
```json
{ "data": { "current_policies_version": "2026-02-17", "force_reacceptance": true } }
```

## 8) Score computation returned by API

Location factor averages:
- Query approved ratings for location and `AVG()` each factor.

Location overall:
- Per rating overall already stored as generated column.
- Location overall raw: `AVG(ratings.overall_score)`.
- Location display: `round(raw * 2) / 2`.

Business weighted overall:
- For each location: `location_avg`, `location_rating_count`.
- Weighted raw: `sum(location_avg * location_rating_count) / sum(location_rating_count)`.
- Weighted display: `round(weighted_raw * 2) / 2`.
- Also return unweighted: `AVG(location_avg)`.
