export type EngagementType = "buy-side-advisory"

export interface UserInput {
  companyName: string
  country: string
  sector: string
  engagementType: EngagementType
  companyWebsite?: string
  additionalLinks?: string[]
  additionalInstructions?: string
}

export interface Citation {
  url: string
  title?: string
  snippet?: string
}

export interface ProgressEvent {
  type: "status" | "complete" | "error" | "ping"
  step: string
  detail?: string
  downloadUrl?: string
  costUSD?: number  // running total
}
