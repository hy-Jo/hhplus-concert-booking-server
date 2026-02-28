-- Concert Reservation Service - Database Initialization
-- Load Test Environment

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- =============================================
-- Table: concert
-- =============================================
CREATE TABLE IF NOT EXISTS `concert` (
  `concertId` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`concertId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- Table: concert_schedule
-- =============================================
CREATE TABLE IF NOT EXISTS `concert_schedule` (
  `scheduleId` varchar(36) NOT NULL,
  `concertId` varchar(36) NOT NULL,
  `concertDate` date NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`scheduleId`),
  KEY `FK_concert_schedule_concertId` (`concertId`),
  CONSTRAINT `FK_concert_schedule_concertId` FOREIGN KEY (`concertId`) REFERENCES `concert` (`concertId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- Table: seat
-- =============================================
CREATE TABLE IF NOT EXISTS `seat` (
  `seatId` varchar(36) NOT NULL,
  `scheduleId` varchar(36) NOT NULL,
  `seatNo` int NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`seatId`),
  UNIQUE KEY `UQ_seat_scheduleId_seatNo` (`scheduleId`, `seatNo`),
  KEY `FK_seat_scheduleId` (`scheduleId`),
  CONSTRAINT `FK_seat_scheduleId` FOREIGN KEY (`scheduleId`) REFERENCES `concert_schedule` (`scheduleId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- Table: queue_token
-- =============================================
CREATE TABLE IF NOT EXISTS `queue_token` (
  `tokenId` varchar(36) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `tokenValue` varchar(255) NOT NULL,
  `queuePosition` int DEFAULT NULL,
  `issuedAt` datetime NOT NULL,
  `expiresAt` datetime NOT NULL,
  `status` enum('WAITING','ACTIVE','EXPIRED') NOT NULL DEFAULT 'WAITING',
  PRIMARY KEY (`tokenId`),
  UNIQUE KEY `UQ_queue_token_tokenValue` (`tokenValue`),
  KEY `IDX_queue_token_userId` (`userId`),
  KEY `IDX_queue_token_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- Table: reservation
-- =============================================
CREATE TABLE IF NOT EXISTS `reservation` (
  `reservationId` varchar(36) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `seatId` varchar(36) NOT NULL,
  `status` enum('HELD','CONFIRMED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'HELD',
  `heldAt` datetime NOT NULL,
  `expiresAt` datetime NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`reservationId`),
  KEY `IDX_reservation_userId` (`userId`),
  KEY `IDX_reservation_seatId` (`seatId`),
  KEY `IDX_reservation_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- Table: payment
-- =============================================
CREATE TABLE IF NOT EXISTS `payment` (
  `paymentId` varchar(36) NOT NULL,
  `reservationId` varchar(36) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `status` enum('SUCCESS','FAILED','CANCELLED') NOT NULL,
  `paidAt` datetime DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`paymentId`),
  UNIQUE KEY `UQ_payment_reservationId` (`reservationId`),
  KEY `IDX_payment_userId` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- Table: user_point_balance
-- =============================================
CREATE TABLE IF NOT EXISTS `user_point_balance` (
  `userId` varchar(36) NOT NULL,
  `balance` decimal(10,2) NOT NULL DEFAULT '0.00',
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- Table: point_tx
-- =============================================
CREATE TABLE IF NOT EXISTS `point_tx` (
  `txId` varchar(36) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `txType` enum('CHARGE','PAYMENT','REFUND') NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `balanceAfter` decimal(10,2) NOT NULL,
  `refPaymentId` varchar(255) DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`txId`),
  KEY `IDX_point_tx_userId` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- Test Data: Concert (3 concerts)
-- =============================================
INSERT INTO `concert` (`concertId`, `title`, `description`, `createdAt`) VALUES
  ('concert_test_1', '테스트 콘서트 1 - 봄 페스티벌', 'Load Test Concert 1', NOW()),
  ('concert_test_2', '테스트 콘서트 2 - 여름 공연', 'Load Test Concert 2', NOW()),
  ('concert_test_3', '테스트 콘서트 3 - 가을 음악회', 'Load Test Concert 3', NOW());

-- =============================================
-- Test Data: Concert Schedule (5 schedules)
-- =============================================
INSERT INTO `concert_schedule` (`scheduleId`, `concertId`, `concertDate`, `createdAt`) VALUES
  ('schedule_test_1', 'concert_test_1', '2026-04-15', NOW()),
  ('schedule_test_2', 'concert_test_1', '2026-04-16', NOW()),
  ('schedule_test_3', 'concert_test_2', '2026-07-20', NOW()),
  ('schedule_test_4', 'concert_test_2', '2026-07-21', NOW()),
  ('schedule_test_5', 'concert_test_3', '2026-10-25', NOW());

-- =============================================
-- Test Data: Seats (50 seats per schedule = 250 total)
-- =============================================
DROP PROCEDURE IF EXISTS CreateTestSeats;
DELIMITER $$
CREATE PROCEDURE CreateTestSeats()
BEGIN
  DECLARE done INT DEFAULT FALSE;
  DECLARE v_scheduleId VARCHAR(50);
  DECLARE seat_num INT;
  DECLARE seat_cursor CURSOR FOR
    SELECT scheduleId FROM concert_schedule WHERE scheduleId LIKE 'schedule_test_%';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

  OPEN seat_cursor;

  schedule_loop: LOOP
    FETCH seat_cursor INTO v_scheduleId;
    IF done THEN
      LEAVE schedule_loop;
    END IF;

    SET seat_num = 1;
    WHILE seat_num <= 50 DO
      INSERT INTO `seat` (`seatId`, `scheduleId`, `seatNo`, `createdAt`)
      VALUES (
        UUID(),
        v_scheduleId,
        seat_num,
        NOW()
      );
      SET seat_num = seat_num + 1;
    END WHILE;
  END LOOP;

  CLOSE seat_cursor;
END$$
DELIMITER ;

CALL CreateTestSeats();
DROP PROCEDURE IF EXISTS CreateTestSeats;

-- =============================================
-- Verify data
-- =============================================
SELECT
  c.concertId,
  c.title,
  COUNT(DISTINCT cs.scheduleId) as schedule_count,
  COUNT(s.seatId) as seat_count
FROM concert c
LEFT JOIN concert_schedule cs ON c.concertId = cs.concertId
LEFT JOIN seat s ON cs.scheduleId = s.scheduleId
WHERE c.concertId LIKE 'concert_test_%'
GROUP BY c.concertId, c.title;
