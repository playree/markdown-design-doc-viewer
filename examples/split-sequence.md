---
type: design_doc
title: Checkout Design
version: 1.0
product: Example
status: Draft
updated: 2026-11-13
---

# Checkout Design

The checkout is too long for one sequence diagram, so it is split into three parts. Notes jump between them with labels named by `%% @anchor` and `%% @goto`:

- A note at the end of a part jumps to the label at the start of the next one, which goes back to it.
- A declined payment in (2) joins (1) in the middle, at the label of a note before **Show error**.
- In (2), an expired card jumps to the branch **Declined**, labeled by an `%% @anchor` on the line before its condition.

## (1) Order

```mermaid
%% @link-headings
sequenceDiagram
    autonumber
    actor User
    participant FE as Frontend
    participant API as Order API
    participant DB as Database

    User->>FE: Place order
    FE->>API: POST /orders
    API->>DB: Save order
    alt Out of stock
        API-->>FE: 409 Conflict
        %% @anchor Show error
        Note over FE: ← also from (2) Declined
        FE-->>User: Show error
    else In stock
        %% @goto Payment
        Note over FE,API: → continued in (2) Payment
    end
```

### Place order

The user confirms the cart and places the order.

### POST /orders

The frontend sends the cart and the delivery address.

### Save order

The order is saved with the status `pending`. The stock is reserved in the same transaction.

### 409 Conflict

When an item is out of stock, the order is not saved and the items are returned to the frontend.

### Show error

The frontend shows why the order failed: the items out of stock, or the declined payment (from (2)).

<!-- link-headings:end -->

## (2) Payment

```mermaid
%% @link-headings
sequenceDiagram
    autonumber
    participant API as Order API
    participant Pay as Payment Service
    participant DB as Database

    %% @anchor Payment
    Note over API: continued from (1) Order
    API->>API: Check card
    %% @goto Declined
    Note over API: Expired card → Declined
    API->>Pay: Authorize payment
    Pay-->>API: Authorization result
    %% @anchor Declined
    alt Declined
        API->>DB: Cancel order
        %% @goto Show error
        Note over API: → (1) Show error
    else Authorized
        API->>DB: Save authorization
        %% @goto Shipping
        Note over API,Pay: → continued in (3) Shipping
    end
```

### Check card

The expiry date of the card is checked before asking the payment service.

### Authorize payment

The total of the order is authorized on the card of the user.

### Authorization result

The payment service answers whether the payment is authorized, with the reason when it is declined.

### Cancel order

The order is set to `canceled` and the reserved stock is released. The error is shown as in (1).

### Save authorization

The authorization ID is saved with the order.

<!-- link-headings:end -->

## (3) Shipping

```mermaid
%% @link-headings
sequenceDiagram
    autonumber
    participant API as Order API
    participant Ship as Shipping Service
    participant Mail as Mail Service

    %% @anchor Shipping
    Note over API: continued from (2) Payment
    API->>Ship: Request shipment
    Ship-->>API: Tracking number
    API->>Mail: Send confirmation
```

### Request shipment

The items and the delivery address are sent to the shipping service.

### Tracking number

The tracking number is saved with the order, whose status becomes `confirmed`.

### Send confirmation

A confirmation email with the tracking number is sent to the user.
