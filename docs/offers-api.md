# API Offerte — Documentazione Frontend

Base URL: `/v2/messages`

---

## Panoramica del flusso

Il sistema offerte segue una logica **unidirezionale**: solo il **buyer** puo fare offerte, il **seller** puo solo **accettare** o **rifiutare**.

```
Buyer invia offerta (messaggio con prezzo)
        |
        v
[Offerte precedenti invalidate automaticamente]
        |
        v
Seller vede l'offerta attiva
        |
        +---> Seller accetta ---> OfferAcceptance (accepted: true)
        |
        +---> Seller rifiuta ---> OfferAcceptance (accepted: false)
        |
        +---> Buyer invia nuova offerta ---> la vecchia viene invalidata
```

### Regole chiave

- In una chat esiste **al massimo una offerta valida** alla volta.
- Quando il buyer invia una nuova offerta, **tutte le offerte precedenti** nella chat vengono automaticamente invalidate (`valid: false`).
- Il seller **non puo fare controfferte**. Puo solo accettare o rifiutare.
- Un'offerta gia rifiutata o accettata non puo ricevere una seconda risposta.
- Un'offerta invalidata (perche il buyer ne ha inviata una nuova) non puo piu essere accettata/rifiutata.

---

## Autenticazione

Tutti gli endpoint richiedono:

| Header          | Descrizione                              |
| --------------- | ---------------------------------------- |
| `Authorization` | `Bearer <JWT>` — il JWT contiene il `sub` con la pubkey dell'utente |

Gli endpoint POST richiedono anche una **firma Schnorr** nel body:

```
signature = schnorr.sign(JSON.stringify(body_senza_signature), privateKey)
```

Il campo `signature` va incluso nel body JSON insieme agli altri campi. Il server verifica che la firma corrisponda alla pubkey del JWT.

---

## Endpoint

### 1. Inviare un messaggio (con o senza offerta)

```
POST /v2/messages/:chatId
```

**Headers:** `Authorization: Bearer <JWT>`

#### A) Messaggio semplice (senza offerta)

**Body:**
```json
{
  "message": "Ciao, sono interessato",
  "signature": "<schnorr_signature>"
}
```

**Risposta 200:**
```json
{
  "id": 1,
  "chatId": 5,
  "message": "Ciao, sono interessato",
  "senderPubkey": "abc123...",
  "signature": "def456...",
  "sentAt": "2026-03-13T10:00:00.000Z"
}
```

#### B) Messaggio con offerta (SOLO buyer)

**Body:**
```json
{
  "message": "Ti offro 50000 sats",
  "offeredPrice": 50000,
  "signature": "<schnorr_signature>"
}
```

> La signature deve essere calcolata su `JSON.stringify({ message: "...", offeredPrice: 50000 })` (tutto il body escluso il campo `signature`).

**Risposta 200:**
```json
{
  "id": 2,
  "chatId": 5,
  "message": "Ti offro 50000 sats",
  "senderPubkey": "abc123...",
  "signature": "def456...",
  "sentAt": "2026-03-13T10:05:00.000Z",
  "offer": {
    "id": 1,
    "messageId": 2,
    "price": 50000,
    "valid": true,
    "createdAt": "2026-03-13T10:05:00.000Z"
  }
}
```

**Cosa succede dietro le quinte:**
1. Tutte le offerte precedenti nella chat vengono settate a `valid: false`
2. Viene creato il messaggio
3. Viene creata l'offerta collegata al messaggio

**Errori:**

| Status | Messaggio                      | Causa                                      |
| ------ | ------------------------------ | ------------------------------------------ |
| 401    | `Missing Bearer token in request` | JWT mancante                            |
| 400    | `Missing signature`            | Campo `signature` non presente nel body    |
| 401    | `Invalid signature`            | Firma non valida per la pubkey             |
| 404    | `Chat not found`               | `chatId` non esiste                        |
| 403    | `Only the buyer can make offers` | Un non-buyer sta cercando di fare un'offerta |

---

### 2. Rispondere a un'offerta (SOLO seller)

```
POST /v2/messages/:chatId/offers/:offerId/respond
```

**Headers:** `Authorization: Bearer <JWT>`

**Body:**
```json
{
  "accepted": true,
  "signature": "<schnorr_signature>"
}
```

> La signature deve essere calcolata su `JSON.stringify({ accepted: true })`.

**Risposta 200 (accettata):**
```json
{
  "id": 1,
  "offerId": 1,
  "signature": "abc123...",
  "accepted": true,
  "createdAt": "2026-03-13T10:10:00.000Z"
}
```

**Risposta 200 (rifiutata):**
```json
{
  "id": 2,
  "offerId": 1,
  "signature": "abc123...",
  "accepted": false,
  "createdAt": "2026-03-13T10:10:00.000Z"
}
```

**Errori:**

| Status | Messaggio                            | Causa                                             |
| ------ | ------------------------------------ | ------------------------------------------------- |
| 404    | `Offer not found`                    | `offerId` non esiste                              |
| 400    | `Offer is no longer valid`           | L'offerta e stata invalidata da una nuova offerta |
| 400    | `Offer already responded to`         | Il seller ha gia risposto a questa offerta        |
| 403    | `Only the seller can respond to offers` | Un non-seller sta cercando di rispondere       |

---

### 3. Ottenere l'offerta attiva

```
GET /v2/messages/:chatId/offers/active
```

**Headers:** `Authorization: Bearer <JWT>`

**Risposta 200:**
```json
{
  "id": 1,
  "messageId": 2,
  "price": 50000,
  "valid": true,
  "createdAt": "2026-03-13T10:05:00.000Z",
  "message": {
    "id": 2,
    "chatId": 5,
    "message": "Ti offro 50000 sats",
    "senderPubkey": "abc123...",
    "signature": "def456...",
    "sentAt": "2026-03-13T10:05:00.000Z"
  },
  "acceptance": null
}
```

**Risposta 200 (con risposta del seller):**
```json
{
  "id": 1,
  "messageId": 2,
  "price": 50000,
  "valid": true,
  "createdAt": "2026-03-13T10:05:00.000Z",
  "message": {
    "id": 2,
    "chatId": 5,
    "message": "Ti offro 50000 sats",
    "senderPubkey": "abc123...",
    "signature": "def456...",
    "sentAt": "2026-03-13T10:05:00.000Z"
  },
  "acceptance": {
    "id": 1,
    "offerId": 1,
    "signature": "abc123...",
    "accepted": true,
    "createdAt": "2026-03-13T10:10:00.000Z"
  }
}
```

**Errori:**

| Status | Messaggio               | Causa                                  |
| ------ | ----------------------- | -------------------------------------- |
| 404    | `No active offer found` | Nessuna offerta valida nella chat      |

---

## Esempio di flusso completo

```
1. Buyer apre una chat con il seller (endpoint esistente)

2. Buyer invia un'offerta:
   POST /v2/messages/5
   { "message": "Offro 40000", "offeredPrice": 40000, "signature": "..." }
   --> 200, messaggio + offerta (id: 1)

3. Seller controlla l'offerta attiva:
   GET /v2/messages/5/offers/active
   --> 200, offerta con price: 40000, acceptance: null

4. Seller rifiuta:
   POST /v2/messages/5/offers/1/respond
   { "accepted": false, "signature": "..." }
   --> 200, acceptance con accepted: false

5. Buyer invia una nuova offerta (la precedente viene invalidata):
   POST /v2/messages/5
   { "message": "Ok, offro 45000", "offeredPrice": 45000, "signature": "..." }
   --> 200, messaggio + offerta (id: 2)
   (offerta id: 1 ora ha valid: false)

6. Seller accetta:
   POST /v2/messages/5/offers/2/respond
   { "accepted": true, "signature": "..." }
   --> 200, acceptance con accepted: true

7. Frontend controlla stato finale:
   GET /v2/messages/5/offers/active
   --> 200, offerta con price: 45000, acceptance: { accepted: true }
```

---

## Note per il frontend

- **Polling/Realtime**: l'endpoint `GET .../offers/active` puo essere usato per polling. Controllare il campo `acceptance` per sapere se il seller ha risposto.
- **UI seller**: il seller non deve mai vedere un form per inserire un prezzo. Solo due bottoni: Accetta / Rifiuta.
- **UI buyer**: quando il buyer invia una nuova offerta, l'offerta precedente diventa automaticamente invalida. Mostrare all'utente che sta "sostituendo" la sua offerta precedente.
- **Offerta rifiutata**: dopo un rifiuto, il buyer puo inviare una nuova offerta. Il flusso ricomincia dal punto 2.
- **`acceptance: null`** significa che il seller non ha ancora risposto.
- **`valid: false`** su un'offerta significa che e stata superata da una nuova offerta del buyer. Non mostrare queste offerte come "attive".
