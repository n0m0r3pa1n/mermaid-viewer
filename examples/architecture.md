# Example: Markdown with several diagrams

Every ```` ```mermaid ```` block in a Markdown file opens as its own tab.
Edits are written back into the right block when you save.

## Request flow

```mermaid
sequenceDiagram
    participant U as User
    participant A as API
    participant D as Database
    U->>A: GET /orders
    A->>D: SELECT * FROM orders
    D-->>A: rows
    A-->>U: 200 OK (JSON)
```

## Order states

```mermaid
stateDiagram-v2
    [*] --> Pending
    Pending --> Paid: payment received
    Paid --> Shipped
    Shipped --> Delivered
    Pending --> Cancelled
    Delivered --> [*]
```
