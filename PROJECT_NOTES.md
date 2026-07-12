# Leaf ↔ Soohi Inventory Sync

## Business Rules

1. Leaf aur Soohi same inventory share karte hain.

2. Sync dono direction me hoga.

3. Matching SKU ke basis par hoga.

4. Agar SKU ek store me nahi mila to usse skip karenge.

5. Sirf 1 active location hai.

6. Quantity same rehni chahiye dono stores me.

7. Polling pehle implement karenge, webhook baad me add karenge.
## Current Status

✅ Authentication working

✅ GraphQL working

✅ Products reading

✅ Inventory Item IDs reading

✅ SKU matching working

❌ Quantity reading pending

❌ Quantity update pending

❌ Auto sync pending