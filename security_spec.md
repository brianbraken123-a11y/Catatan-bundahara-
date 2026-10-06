# Security Specification: CatatKas Firestore

## 1. Data Invariants
1. Each Transaction MUST have a valid `userId` matching `request.auth.uid` for client operations.
2. A client can only read, create, update, and delete their own transactions (`resource.data.userId == request.auth.uid`).
3. Transactions must have valid `type` ("income" or "expense"), non-negative `amount`, non-empty `category`, non-empty `description`, valid `date` format (YYYY-MM-DD), and valid `source` ("web" or "telegram").
4. User profiles (`users/{userId}`) can only be read or written by the authenticated owner (`request.auth.uid == userId`).
5. `telegramUsers` and `telegramUpdates` are restricted to server-side webhook operations (Admin SDK bypasses rules). Clients cannot read or tamper with telegram mappings or update logs.
6. `telegramLinkCodes` can be created by authenticated users for their own `userId`.

## 2. The Dirty Dozen Payloads (Rejection Matrix)
1. **Unauthenticated Read**: Attempting to read `/transactions` without signing in -> REJECT.
2. **Cross-User Read**: User A attempting to get `/transactions/{docId}` owned by User B -> REJECT.
3. **Cross-User List**: User A querying transactions where `userId == User B` -> REJECT.
4. **Identity Spoofing on Create**: User A attempting to create a transaction with `userId: User B` -> REJECT.
5. **Ghost Field Injection**: Adding an unpermitted field `isApproved: true` to Transaction -> REJECT.
6. **Negative Amount**: Setting `amount: -50000` -> REJECT.
7. **Invalid Type**: Setting `type: "crypto"` -> REJECT.
8. **Invalid Date Format**: Setting `date: "yesterday"` -> REJECT.
9. **Tampering User Profile**: User A writing to `/users/UserB` -> REJECT.
10. **Client Tampering Telegram Updates**: Direct client write to `/telegramUpdates/{updateId}` -> REJECT.
11. **Client Tampering Telegram Users**: Direct client write to `/telegramUsers/{chatId}` -> REJECT.
12. **Oversized String Injection (Denial of Wallet)**: Setting `description` to a 50KB payload -> REJECT.
