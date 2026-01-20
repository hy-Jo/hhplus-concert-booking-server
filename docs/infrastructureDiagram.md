# Infrastructure Diagram (D2)

direction: right

Clients: {
  label: "Clients"
  style: {fill: "#F3F4F6"; stroke: "#9CA3AF"; border-radius: 16}

  U: "User\n(Web/Mobile)" {
    shape: person
    style: {fill: "#FFFFFF"; stroke: "#374151"; border-radius: 18}
  }
}

Edge: {
  label: "Edge"
  style: {fill: "#EEF2FF"; stroke: "#818CF8"; border-radius: 16}

  LB: "Load Balancer\n/API Endpoint" {
    shape: cloud
    style: {fill: "#FFFFFF"; stroke: "#4F46E5"; border-radius: 18}
  }
}

App: {
  label: "Application"
  style: {fill: "#ECFDF5"; stroke: "#34D399"; border-radius: 16}

  API: "Backend API\n(Queue + Concert + Reservation + Payment + Point)" {
    shape: rectangle
    style: {fill: "#FFFFFF"; stroke: "#059669"; border-radius: 18}
  }

  Worker: "Background Job\n(Hold Expiry)" {
    shape: rectangle
    style: {fill: "#FFFFFF"; stroke: "#10B981"; border-radius: 18}
  }
}

Data: {
  label: "Data"
  style: {fill: "#FFFBEB"; stroke: "#F59E0B"; border-radius: 16}

  RDB: "RDBMS\n(Seats/Reservations/Payments/PointTx)" {
    shape: cylinder
    style: {fill: "#FFFFFF"; stroke: "#B45309"; border-radius: 18}
  }

  Redis: "Redis\n(Queue Token + Seat Hold TTL 5m)" {
    shape: cylinder
    style: {fill: "#FFFFFF"; stroke: "#D97706"; border-radius: 18}
  }
}

External: {
  label: "External"
  style: {fill: "#FDF2F8"; stroke: "#F472B6"; border-radius: 16}

  PG: "Payment Gateway" {
    shape: cloud
    style: {fill: "#FFFFFF"; stroke: "#DB2777"; border-radius: 18}
  }
}

# ✅ 포인트: 클러스터 내부 노드는 "Cluster.Node"로 연결
Clients.U -> Edge.LB: "HTTPS" {style: {stroke: "#6B7280"; stroke-width: 2}}
Edge.LB -> App.API: "REST" {style: {stroke: "#6B7280"; stroke-width: 2}}

App.API -> Data.RDB: "CRUD" {style: {stroke: "#6B7280"; stroke-width: 2}}
App.API -> Data.Redis: "Token/Hold TTL" {style: {stroke: "#6B7280"; stroke-width: 2}}
App.API -> External.PG: "Pay Request" {style: {stroke: "#6B7280"; stroke-width: 2}}

App.API -> App.Worker: "Trigger" {style: {stroke: "#6B7280"; stroke-width: 2}}
App.Worker -> Data.RDB: "Expire Reservation" {style: {stroke: "#6B7280"; stroke-width: 2}}
App.Worker -> Data.Redis: "Release Hold" {style: {stroke: "#6B7280"; stroke-width: 2}}
