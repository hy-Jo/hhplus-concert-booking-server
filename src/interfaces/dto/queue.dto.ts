export class IssueTokenRequest {
  userId: string;
}

export class IssueTokenResponse {
  token: string;
  userId: string;
  queuePosition: number;
  expiresAt: Date;
}

export class QueueStatusResponse {
  queuePosition: number;
  status: string;
}
