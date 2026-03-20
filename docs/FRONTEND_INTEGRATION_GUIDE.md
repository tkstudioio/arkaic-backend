# Frontend Integration Guide: Chat Listing & Favorites Features

This document provides a complete guide for frontend developers integrating the newly implemented chat listing and favorites management features.

## Overview

Three core features have been implemented:

1. **Chat Listing Endpoint** — Unified endpoint to retrieve all chats for the authenticated user (as buyer or seller)
2. **Favorites Management** — Full CRUD API for user bookmarking of listings
3. **Listing Favorites Integration** — Each listing now includes favorite count and user's favorite status

---

## Feature 1: Chat Listing (`GET /api/chats`)

### Purpose
Retrieve a paginated list of all chats involving the authenticated user. This replaces the need to make separate requests to list chats as a buyer and seller.

### Endpoint
```
GET /api/chats?limit=20&offset=0
```

### Query Parameters
- `limit`: Max results per page (default 20, max 100)
- `offset`: Results to skip for pagination (default 0)

### What You Get
Each chat in the response includes:
- **Chat metadata**: ID, listing ID, status, creation date
- **Participants**: Buyer details, Seller details (from listing)
- **Most recent message**: Latest message in the chat (if any)
- **Offer info**: The most recent message may contain an offer with acceptance status
- **Escrow status**: If an escrow exists, its current status is included

### Response Shape
```json
{
  "chats": [
    {
      "id": 123,
      "listingId": 42,
      "buyerPubkey": "...",
      "buyer": { "pubkey": "...", "username": "Alice", ... },
      "listing": {
        "id": 42,
        "name": "iPhone 15 Pro",
        "price": 50000,
        "seller": { "pubkey": "...", "username": "Bob", ... },
        "category": { "id": 2, "name": "Electronics", ... }
      },
      "escrow": { "status": "fundLocked" } | null,
      "messages": [
        {
          "id": 5001,
          "message": "Is this available?",
          "sentAt": "2026-03-20T10:30:00Z",
          "offer": {
            "id": 101,
            "price": 45000,
            "valid": true,
            "acceptance": { "accepted": false, ... } | null
          } | null
        }
      ],
      "status": "open",
      "createdAt": "2026-03-20T09:00:00Z"
    }
  ],
  "total": 5
}
```

### Common Use Cases

**Display user's chat inbox:**
```typescript
// On user's "Messages" or "Chats" tab
const response = await fetch('/api/chats?limit=20&offset=0', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const { chats, total } = await response.json();

// Render chat list
chats.forEach(chat => {
  const otherParty = chat.buyerPubkey === userPubkey ? chat.listing.seller : chat.buyer;
  const lastMsg = chat.messages[0];

  // Show: [OtherParty] - [Last message preview] - [Time]
  // Badge: unread count, escrow status, offer status
});
```

**Implement pagination:**
```typescript
const pageSize = 20;
let currentPage = 0;

async function loadPage(page: number) {
  const offset = page * pageSize;
  const response = await fetch(`/api/chats?limit=${pageSize}&offset=${offset}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const { chats, total } = await response.json();
  currentPage = page;
  return { chats, hasMore: offset + pageSize < total };
}
```

**Quick status indicators:**
```typescript
const chat = chats[0];
const buyer = chat.buyerPubkey === userPubkey;
const otherParty = buyer ? chat.listing.seller : chat.buyer;

// Show user role
const myRole = buyer ? 'Buyer' : 'Seller';

// Show last message preview
const lastMsg = chat.messages[0]?.message || '(no messages)';

// Show escrow status if exists
if (chat.escrow) {
  const status = chat.escrow.status; // 'fundLocked', 'completed', etc.
  // Render status badge
}

// Show active offer status
const activeOffer = chat.messages[0]?.offer;
if (activeOffer?.valid) {
  if (!activeOffer.acceptance) {
    // Waiting for response
  } else if (activeOffer.acceptance.accepted) {
    // Accepted - can proceed to escrow
  } else {
    // Rejected
  }
}
```

---

## Feature 2: Favorites Management

### Purpose
Allow users to bookmark listings for later reference without committing to a purchase.

### Endpoints

#### `GET /api/favorites` — List User's Favorites
```
GET /api/favorites?limit=20&offset=0
```

Returns paginated list of the user's favorited listings with full listing details.

```json
{
  "favorites": [
    {
      "id": 1,
      "accountPubkey": "...",
      "listingId": 42,
      "createdAt": "2026-03-19T15:00:00Z",
      "listing": {
        "id": 42,
        "name": "iPhone 15 Pro",
        "price": 50000,
        "description": "Brand new",
        "seller": { "pubkey": "...", "username": "Bob", ... },
        "category": { ... },
        "attributes": [ ... ],
        "_count": { "favorites": 12 },
        // Note: isFavorited not included here (already in Favorite record)
      }
    }
  ],
  "total": 3
}
```

**Key points:**
- Each favorite includes the full listing object
- Ordered by `createdAt` descending (most recent first)
- Paginated with `limit` and `offset` params

**Use case:**
```typescript
async function loadFavorites() {
  const response = await fetch('/api/favorites?limit=20&offset=0', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const { favorites, total } = await response.json();

  // Render favorited listings
  favorites.forEach(fav => {
    const listing = fav.listing;
    // Show: [Image] [Name] [Price] [Seller] [Remove button]
  });
}
```

#### `POST /api/favorites/:listingId` — Add to Favorites
```
POST /api/favorites/42
```

**Response (201):**
```json
{
  "id": 1,
  "accountPubkey": "...",
  "listingId": 42,
  "createdAt": "2026-03-20T10:00:00Z"
}
```

**Key points:**
- Idempotent: Adding the same listing twice succeeds (no error)
- Returns 400 if trying to favorite your own listing
- Returns 404 if listing doesn't exist

**Use case:**
```typescript
async function toggleFavorite(listingId: number, isFavorited: boolean) {
  if (isFavorited) {
    // Remove from favorites
    await fetch(`/api/favorites/${listingId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } else {
    // Add to favorites
    const response = await fetch(`/api/favorites/${listingId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      // Update UI: toggle favorite button
      updateFavoriteButton(listingId, true);
    }
  }
}
```

#### `DELETE /api/favorites/:listingId` — Remove from Favorites
```
DELETE /api/favorites/42
```

**Response (200):**
```json
{
  "deleted": true
}
```

**Key points:**
- Idempotent: Removing a non-favorited listing succeeds (no error)
- Always returns 200

---

## Feature 3: Listing Favorites Integration

### New Fields on Listing Objects

Every listing now includes two new fields:

#### `_count.favorites` — Total Favorite Count
```json
{
  "id": 42,
  "name": "iPhone 15 Pro",
  "price": 50000,
  ...
  "_count": {
    "favorites": 12  // Total count across all users
  }
}
```

#### `isFavorited` — User's Favorite Status
```json
{
  "id": 42,
  "name": "iPhone 15 Pro",
  "price": 50000,
  ...
  "isFavorited": true  // Whether THIS user has favorited this listing
}
```

### Which Endpoints Include These Fields

✅ Included:
- `GET /api/listings` — List all listings (with pagination, filters)
- `GET /api/listings/:id` — Single listing details
- `GET /api/listings/my-listings` — User's own listings

❌ Not included:
- `POST /api/listings` — Creation response (isFavorited would always be false)
- `PATCH /api/listings/:id` — Update response (isFavorited would always be false)

### Usage in Frontend

**Show favorite count on listing card:**
```typescript
const listing = listings[0];
const favoriteCount = listing._count.favorites;

// Render: "❤️ 12 people favorited this"
// Or just: "12 ❤️"
```

**Show favorite button state:**
```typescript
const isFavorited = listing.isFavorited;

function renderFavoriteButton(listing) {
  return `
    <button
      class="favorite-btn ${isFavorited ? 'active' : ''}"
      onclick="toggleFavorite(${listing.id}, ${isFavorited})"
      aria-label="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}"
    >
      ${isFavorited ? '❤️' : '🤍'}
    </button>
  `;
}
```

**Update favorite count after toggle:**
```typescript
async function toggleFavorite(listingId: number, isFavorited: boolean) {
  const method = isFavorited ? 'DELETE' : 'POST';
  const response = await fetch(`/api/favorites/${listingId}`, {
    method,
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (response.ok) {
    // Update local state
    const newIsFavorited = !isFavorited;
    updateLocalListing(listingId, {
      isFavorited: newIsFavorited,
      _count: {
        favorites: listing._count.favorites + (newIsFavorited ? 1 : -1)
      }
    });

    // Re-render UI
    renderListing(updatedListing);
  }
}
```

---

## Complete Integration Example

### Setup: Authentication
```typescript
// Get token from login
const token = localStorage.getItem('authToken');

function makeAuthedRequest(url: string, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    }
  });
}
```

### Feature: Browse Listings with Favorites
```typescript
async function displayListingBrowser() {
  // 1. Load listings with favorite info
  const listingsRes = await makeAuthedRequest(
    '/api/listings?limit=20&sort=newest'
  );
  const { listings, total } = await listingsRes.json();

  // 2. Render each listing
  const html = listings.map(listing => `
    <div class="listing-card">
      <h3>${listing.name}</h3>
      <p>Price: ${listing.price} sat</p>
      <p>Seller: ${listing.seller.username}</p>

      <!-- Favorite count -->
      <p>❤️ ${listing._count.favorites}</p>

      <!-- Favorite button -->
      <button
        class="favorite-btn ${listing.isFavorited ? 'active' : ''}"
        onclick="toggleFavorite(${listing.id}, ${listing.isFavorited})"
      >
        ${listing.isFavorited ? 'Remove from Favorites' : 'Add to Favorites'}
      </button>

      <!-- Contact seller button -->
      <button onclick="openChat(${listing.id})">
        Contact Seller
      </button>
    </div>
  `).join('');

  document.getElementById('listings').innerHTML = html;
}

async function toggleFavorite(listingId: number, isFavorited: boolean) {
  const method = isFavorited ? 'DELETE' : 'POST';
  const response = await makeAuthedRequest(`/api/favorites/${listingId}`, {
    method
  });

  if (response.ok) {
    // Reload the listing to get updated counts
    displayListingBrowser();
  } else {
    alert('Failed to update favorite');
  }
}
```

### Feature: Display Chat Inbox
```typescript
async function displayChatInbox() {
  // 1. Load all user chats
  const chatsRes = await makeAuthedRequest('/api/chats?limit=20&offset=0');
  const { chats, total } = await chatsRes.json();

  // 2. Render each chat
  const html = chats.map(chat => {
    const isUserBuyer = chat.buyerPubkey === userPubkey;
    const otherParty = isUserBuyer ? chat.listing.seller : chat.buyer;
    const lastMsg = chat.messages[0];
    const escrowStatus = chat.escrow?.status;

    return `
      <div class="chat-item" onclick="openChat(${chat.id})">
        <h4>${otherParty.username}</h4>
        <p>${chat.listing.name}</p>
        <p class="message-preview">${lastMsg?.message || '(no messages)'}</p>

        ${escrowStatus ? `<span class="badge">${escrowStatus}</span>` : ''}

        ${lastMsg?.offer ? `
          <span class="badge offer">
            Offer: ${lastMsg.offer.price} sat
            ${lastMsg.offer.acceptance?.accepted ? '✓ Accepted' : ''}
          </span>
        ` : ''}
      </div>
    `;
  }).join('');

  document.getElementById('chats').innerHTML = html;
}
```

### Feature: View Favorites List
```typescript
async function displayFavoritesList() {
  // 1. Load user's favorites
  const favsRes = await makeAuthedRequest('/api/favorites?limit=20&offset=0');
  const { favorites, total } = await favsRes.json();

  // 2. Render each favorite
  const html = favorites.map(fav => {
    const listing = fav.listing;
    return `
      <div class="favorite-card">
        <h3>${listing.name}</h3>
        <p>Price: ${listing.price} sat</p>
        <p>Seller: ${listing.seller.username}</p>

        <button
          class="remove-btn"
          onclick="removeFavorite(${listing.id})"
        >
          Remove from Favorites
        </button>

        <button onclick="viewListing(${listing.id})">
          View Details
        </button>
      </div>
    `;
  }).join('');

  document.getElementById('favorites').innerHTML = html;
}

async function removeFavorite(listingId: number) {
  const response = await makeAuthedRequest(`/api/favorites/${listingId}`, {
    method: 'DELETE'
  });

  if (response.ok) {
    displayFavoritesList(); // Reload
  }
}
```

---

## Error Handling Reference

### Chat Listing Errors
```
400: Invalid limit or offset
401: Missing/invalid Bearer token
```

### Favorites Errors
```
400: Invalid listingId (not numeric)
400: Cannot favorite your own listing
401: Missing/invalid Bearer token
404: Listing not found (POST/DELETE)
```

### Listing Endpoint Errors (with isFavorited)
```
400: Invalid pagination or filters
401: Missing/invalid Bearer token
404: Listing not found (GET /:id)
```

### Error Handling Pattern
```typescript
async function safeRequest(url: string, options = {}) {
  try {
    const response = await makeAuthedRequest(url, options);

    if (!response.ok) {
      const text = await response.text();
      const message = (() => {
        switch (response.status) {
          case 400: return `Invalid request: ${text}`;
          case 401: return 'Please log in again';
          case 403: return 'Not authorized';
          case 404: return 'Not found';
          default: return 'Server error';
        }
      })();

      throw new Error(message);
    }

    return response.json();
  } catch (error) {
    console.error('Request failed:', error);
    showError(error.message);
    throw error;
  }
}
```

---

## Performance Considerations

### Pagination
Always use pagination for list endpoints to avoid large responses:
```typescript
// Good ✓
GET /api/chats?limit=20&offset=0
GET /api/favorites?limit=20&offset=0

// Bad ✗ (may timeout or return huge dataset)
GET /api/chats?limit=1000
```

### Caching
Consider caching favorite state locally to reduce requests:
```typescript
// Cache favorite state after toggle
const listingCache = new Map<number, { isFavorited: boolean }>();

async function toggleFavorite(listingId: number, isFavorited: boolean) {
  // Optimistic update
  listingCache.set(listingId, { isFavorited: !isFavorited });
  updateUI(listingId);

  // Verify with server
  const response = await makeAuthedRequest(`/api/favorites/${listingId}`, {
    method: isFavorited ? 'DELETE' : 'POST'
  });

  if (!response.ok) {
    // Revert on error
    listingCache.set(listingId, { isFavorited });
    updateUI(listingId);
  }
}
```

### Real-time Updates
For real-time chat updates, use WebSocket:
```typescript
// New messages and offers notify via WebSocket
// Reconnect to /ws?token=<JWT>
// Listen for: new_message, new_offer, offer_accepted, offer_rejected
```

---

## API Reference Quick Links

- [Chat API Documentation](docs/api-chats.md)
- [Favorites API Documentation](docs/api-favorites.md)
- [Listings API Documentation](docs/api-listings.md)
- [Complete API Reference](README.md#api-reference)

---

## Summary of Changes

| What | Endpoint | Method | Status |
|------|----------|--------|--------|
| **NEW** | Chat Listing | `GET /api/chats` | 200, 400, 401 |
| **NEW** | List Favorites | `GET /api/favorites` | 200, 400, 401 |
| **NEW** | Add Favorite | `POST /api/favorites/:listingId` | 201, 400, 401, 404 |
| **NEW** | Remove Favorite | `DELETE /api/favorites/:listingId` | 200, 400, 401 |
| **ENHANCED** | Listings | All endpoints | Now includes `_count.favorites` and `isFavorited` |

---

## Questions or Issues?

Refer to the detailed endpoint documentation in `docs/` or contact the backend team.
