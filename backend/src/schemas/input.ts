import { z } from 'zod'

export const UserInputSchema = z.object({
  companyName: z.string().min(1),
  country: z.string().min(1),
  sector: z.string().min(1),
  engagementType: z.literal('buy-side-advisory'),
  companyWebsite: z.string().url().optional().or(z.literal('')),
  additionalLinks: z.array(z.string().url()).optional(),
  additionalInstructions: z.string().optional(),
})

export type UserInput = z.infer<typeof UserInputSchema>
