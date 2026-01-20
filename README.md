# 콘서트 예약 서비스

대기열 시스템을 활용한 콘서트 좌석 예약 서비스입니다.

## 📋 프로젝트 소개

사용자는 대기열을 통해 순서대로 콘서트 좌석을 예약하고, 포인트를 사용하여 결제할 수 있습니다.
동시성 제어를 통해 안정적인 예약 시스템을 제공합니다.

### 주요 기능

- 🎫 **대기열 시스템**: 토큰 기반 대기열로 공정한 예약 기회 제공
- 🎵 **콘서트 조회**: 예약 가능한 날짜 및 좌석 조회 (1-50번 좌석)
- 📝 **좌석 예약**: 5분간 임시 배정 후 자동 해제
- 💰 **포인트 충전/조회**: 결제에 사용할 포인트 관리
- 💳 **결제 처리**: 포인트를 사용한 좌석 결제 및 확정

### 기술적 특징

- ✅ 동시성 제어: 중복 예약 방지 (낙관적/비관적 락)
- ✅ 임시 배정 자동 해제: 5분 후 미결제 좌석 자동 복원
- ✅ 다중 인스턴스 지원: 분산 환경에서도 안정적 동작
- ✅ JWT 기반 인증: 대기열 토큰 관리

## 🛠️ 기술 스택

### Backend
- **Framework**: NestJS 10.x
- **Language**: TypeScript 5.x
- **ORM**: TypeORM 0.3.x
- **Database**: MySQL 8.0
- **API Documentation**: Swagger/OpenAPI 3.0

### DevOps
- **Container**: Docker
- **Package Manager**: Yarn
- **Testing**: Jest

## 📚 문서

### API 명세서
- [OpenAPI Specification](./api/openapi.yaml)
- Swagger Editor에서 확인: https://editor.swagger.io/
- 로컬 실행: http://localhost:3000/api-docs
  <img width="935" height="717" alt="image" src="https://github.com/user-attachments/assets/0b0bb74b-c19c-4936-af5c-eb09d80db0f1" />


### 데이터베이스 설계
- [ERD (Entity Relationship Diagram)](./docs/erd.md)
  <img width="1244" height="897" alt="image" src="https://github.com/user-attachments/assets/0271962b-fa3b-4d98-8c4e-058c808293c8" />



### 인프라 구성
- [Infrastructure Diagram](./docs/Infrastructure_Diagram.md)
<img width="1873" height="746" alt="image" src="https://github.com/user-attachments/assets/34b89be8-5078-4c6d-9a88-8711a86a5628" />

## 🚀 시작하기

### 사전 요구사항

- Node.js 20.x 이상
- Docker Desktop (MySQL 컨테이너용)
- Yarn

### 설치 및 실행

1. **의존성 설치**
```bash
yarn install
```

2. **MySQL 컨테이너 실행**
```bash
docker run --name concert-mysql \
  -e MYSQL_ROOT_PASSWORD=password \
  -e MYSQL_DATABASE=concert_reservation \
  -p 3307:3306 \
  -d mysql:8.0
```

3. **환경 변수 설정**

`.env.development` 파일을 생성하고 다음 내용을 추가:
```env
DB_HOST=localhost
DB_PORT=3307
DB_DATABASE=concert_reservation
DB_USERNAME=root
DB_PASSWORD=password
DB_LOGGING_ENABLED=true

NODE_ENV=development
PORT=3000
```

4. **서버 실행**
```bash
# 개발 모드
yarn start:dev

# 프로덕션 모드
yarn build
yarn start:prod
```

5. **API 문서 확인**
```
http://localhost:3000/api-docs
```

## 🧪 테스트

```bash
# 단위 테스트
yarn test

# 통합 테스트
yarn test:it

# E2E 테스트
yarn test:e2e

# 커버리지
yarn test:cov
```

## 📝 API 명세서 검증

```bash
# OpenAPI 명세서 검증
yarn api:validate

# 명세서 번들링
yarn api:bundle
```

## 🗂️ 프로젝트 구조

```
server/
├── api/                    # API 명세서
│   └── openapi.yaml
├── docs/                   # 문서
│   ├── erd.md
│   └── Infrastructure Diagram.md
├── src/                    # 소스 코드
│   ├── controllers/        # 컨트롤러
│   ├── dto/               # Data Transfer Objects
│   ├── database/          # 데이터베이스 설정
│   ├── app.module.ts      # 루트 모듈
│   └── main.ts            # 진입점
├── test/                   # 테스트
│   ├── it/                # 통합 테스트
│   └── e2e/               # E2E 테스트
├── migrations/            # 데이터베이스 마이그레이션
├── .env.development       # 환경 변수 (개발)
├── .gitignore
├── package.json
└── README.md
```

## 📌 주요 API 엔드포인트

### 1. 대기열 관리
- `POST /api/queue/token` - 대기열 토큰 발급
- `GET /api/queue/status` - 대기번호 조회

### 2. 콘서트 조회
- `GET /api/concerts/dates` - 예약 가능한 날짜 목록
- `GET /api/concerts/seats` - 예약 가능한 좌석 조회

### 3. 예약 관리
- `POST /api/reservations` - 좌석 예약 요청

### 4. 포인트 관리
- `POST /api/points/charge` - 포인트 충전
- `GET /api/points/balance` - 포인트 잔액 조회

### 5. 결제
- `POST /api/payments` - 결제 처리

## 🔐 인증

모든 API는 대기열 토큰이 필요합니다 (토큰 발급 API 제외).

```http
Authorization: Bearer <your-queue-token>
```

## 🎯 핵심 비즈니스 로직

### 좌석 예약 프로세스
1. 사용자가 대기열 토큰 발급 받음
2. 대기 순서가 되어 ACTIVE 상태가 됨
3. 예약 가능한 좌석 조회
4. 좌석 예약 요청 (5분간 임시 배정)
5. 5분 내에 포인트로 결제
6. 결제 완료 시 좌석 확정, 토큰 만료

### 동시성 제어
- **좌석 예약**: 데이터베이스 락을 사용하여 동시 예약 방지
- **포인트 차감**: 트랜잭션과 락을 통해 정확한 잔액 관리
- **임시 배정 해제**: 스케줄러를 통해 5분 후 자동 해제

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 라이선스

This project is licensed under the UNLICENSED License.

## 👥 Contact

Project Link: [https://github.com/yourusername/concert-reservation](https://github.com/yourusername/concert-reservation)
