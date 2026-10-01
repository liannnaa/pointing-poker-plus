
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "jira_credentials": {
                  Row: {
                    "ac_field": string | null,"base_url": string,"created_at": string,"email": string,"encrypted_token": string,"id": string,"project_key": string | null,"story_points_field": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "ac_field"?: string | null,"base_url": string,"created_at"?: string,"email": string,"encrypted_token": string,"id"?: string,"project_key"?: string | null,"story_points_field"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "ac_field"?: string | null,"base_url"?: string,"created_at"?: string,"email"?: string,"encrypted_token"?: string,"id"?: string,"project_key"?: string | null,"story_points_field"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"participants": {
                  Row: {
                    "avatar_emoji": string | null,"display_name": string,"id": string,"joined_at": string,"session_id": string,"user_id": string
                  }
                  Insert: {
                    "avatar_emoji"?: string | null,"display_name": string,"id"?: string,"joined_at"?: string,"session_id": string,"user_id": string
                  }
                  Update: {
                    "avatar_emoji"?: string | null,"display_name"?: string,"id"?: string,"joined_at"?: string,"session_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "participants_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"sessions": {
                  Row: {
                    "capacity_points": number | null,"code": string,"created_at": string,"current_issue_key": string | null,"facilitator_id": string,"id": string,"jira_base_url": string | null,"jira_email": string | null,"state": string,"target_board_id": number | null,"target_sprint_id": number | null,"target_sprint_name": string | null
                  }
                  Insert: {
                    "capacity_points"?: number | null,"code": string,"created_at"?: string,"current_issue_key"?: string | null,"facilitator_id": string,"id"?: string,"jira_base_url"?: string | null,"jira_email"?: string | null,"state"?: string,"target_board_id"?: number | null,"target_sprint_id"?: number | null,"target_sprint_name"?: string | null
                  }
                  Update: {
                    "capacity_points"?: number | null,"code"?: string,"created_at"?: string,"current_issue_key"?: string | null,"facilitator_id"?: string,"id"?: string,"jira_base_url"?: string | null,"jira_email"?: string | null,"state"?: string,"target_board_id"?: number | null,"target_sprint_id"?: number | null,"target_sprint_name"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"sprint_plan_items": {
                  Row: {
                    "added_by": string,"assignee_account_id": string | null,"created_at": string,"id": string,"issue_key": string,"origin": string,"points": number | null,"position": number,"removed": boolean,"session_id": string,"summary": string
                  }
                  Insert: {
                    "added_by": string,"assignee_account_id"?: string | null,"created_at"?: string,"id"?: string,"issue_key": string,"origin"?: string,"points"?: number | null,"position"?: number,"removed"?: boolean,"session_id": string,"summary": string
                  }
                  Update: {
                    "added_by"?: string,"assignee_account_id"?: string | null,"created_at"?: string,"id"?: string,"issue_key"?: string,"origin"?: string,"points"?: number | null,"position"?: number,"removed"?: boolean,"session_id"?: string,"summary"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sprint_plan_items_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"sprint_teammates": {
                  Row: {
                    "account_id": string,"avatar_url": string | null,"capacity_points": number | null,"created_at": string,"display_name": string,"email": string | null,"id": string,"position": number,"session_id": string
                  }
                  Insert: {
                    "account_id": string,"avatar_url"?: string | null,"capacity_points"?: number | null,"created_at"?: string,"display_name": string,"email"?: string | null,"id"?: string,"position"?: number,"session_id": string
                  }
                  Update: {
                    "account_id"?: string,"avatar_url"?: string | null,"capacity_points"?: number | null,"created_at"?: string,"display_name"?: string,"email"?: string | null,"id"?: string,"position"?: number,"session_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sprint_teammates_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"votes": {
                  Row: {
                    "created_at": string,"id": string,"issue_key": string,"session_id": string,"user_id": string,"value": number
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"issue_key": string,"session_id": string,"user_id": string,"value": number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"issue_key"?: string,"session_id"?: string,"user_id"?: string,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "votes_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "sessions"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const

