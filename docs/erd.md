# ERD (mermaid)


erDiagram
    USER ||--|| USER_POINT_BALANCE : has
    USER ||--o{ POINT_TX : makes
    USER ||--o{ QUEUE_TOKEN : gets
    USER ||--o{ RESERVATION : reserves
    USER ||--o{ PAYMENT : pays

    CONCERT ||--o{ CONCERT_SCHEDULE : has
    CONCERT_SCHEDULE ||--o{ SEAT : contains

    SEAT ||--o{ RESERVATION : reserved_by
    RESERVATION ||--o| PAYMENT : paid_by

    USER {
        uuid user_id PK
        string name
        datetime created_at
    }

    USER_POINT_BALANCE {
        uuid user_id PK, FK
        decimal balance
        datetime updated_at
    }

    POINT_TX {
        uuid tx_id PK
        uuid user_id FK
        string tx_type  "CHARGE|PAYMENT|REFUND"
        decimal amount
        decimal balance_after
        uuid ref_payment_id FK "nullable"
        datetime created_at
    }

    QUEUE_TOKEN {
        uuid token_id PK
        uuid user_id FK
        string token_value "unique"
        int queue_position "optional"
        datetime issued_at
        datetime expires_at
        string status "ACTIVE|EXPIRED|REVOKED"
    }

    CONCERT {
        uuid concert_id PK
        string title
        string description
        datetime created_at
    }

    CONCERT_SCHEDULE {
        uuid schedule_id PK
        uuid concert_id FK
        date concert_date
        datetime created_at
    }

    SEAT {
        uuid seat_id PK
        uuid schedule_id FK
        int seat_no  "1..50"
        datetime created_at
    }

    RESERVATION {
        uuid reservation_id PK
        uuid user_id FK
        uuid seat_id FK
        string status "HELD|CONFIRMED|CANCELLED|EXPIRED"
        datetime held_at
        datetime expires_at  "e.g., held_at+5min"
        datetime created_at
    }

    PAYMENT {
        uuid payment_id PK
        uuid reservation_id FK "unique"
        uuid user_id FK
        decimal amount
        string status "SUCCESS|FAILED|CANCELLED"
        datetime paid_at
        datetime created_at
    }
