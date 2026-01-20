sequenceDiagram
    autonumber
    actor U as User
    participant API as Backend API
    participant Q as Queue(Token) Service
    participant R as Redis
    participant DB as RDBMS
    participant PG as Payment Gateway
    participant W as Worker(Expiry)

    rect rgb(238,242,255)
    Note over U,API: 1) Queue Token 발급/검증
    U->>API: 콘서트/좌석 페이지 접근
    API->>Q: queueToken 발급 요청(user/session)
    Q->>R: token 저장(TTL)
    Q-->>API: queueToken
    API-->>U: queueToken 포함 응답

    U->>API: 좌석 조회/예약 요청(queueToken 포함)
    API->>Q: queueToken 검증
    Q->>R: token 유효/만료 확인
    Q-->>API: OK/Reject
    API-->>U: OK면 다음 단계 진행
    end

    rect rgb(236,253,245)
    Note over U,API: 2) Seat Hold (5분 임시배정)
    U->>API: Hold 요청(scheduleId, seatNo)
    API->>R: SETNX seatHold:scheduleId:seatNo=userId (TTL=5m)
    alt Hold 성공
        API->>DB: Reservation 생성(status=HELD, expiresAt=now+5m)
        DB-->>API: reservationId
        API-->>U: Hold 성공(reservationId, expiresAt)
    else 이미 Hold 중
        API-->>U: Hold 실패(다른 좌석 선택)
    end
    end

    rect rgb(253,242,248)
    Note over U,API: 3) 결제 성공 시 확정 + 만료 처리
    U->>API: 결제 요청(reservationId)
    API->>DB: Reservation 조회(HELD & not expired?)
    alt 유효한 HELD
        API->>PG: 결제 요청(amount)
        PG-->>API: 결제 성공(paymentKey)
        API->>DB: Payment 저장(SUCCESS)
        API->>DB: Point 차감(원장 기록)
        API->>DB: Reservation 상태 변경(HELD->CONFIRMED)
        API->>R: DEL seatHold key (정리)
        API-->>U: 결제 완료 + 좌석 확정
    else 만료/이미확정/취소
        API-->>U: 결제 불가(예약 만료/상태 오류)
    end

    Note over W,DB: 주기 작업(또는 스케줄러)
    W->>DB: 만료된 HELD 조회
    W->>DB: Reservation EXPIRED 처리
    W->>R: seatHold key 정리(존재 시 삭제)
    end
