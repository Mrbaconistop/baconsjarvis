// Add this to social.functions.ts

export const importCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .array(
        z.object({
          platform: z.enum(["twitter", "linkedin", "instagram", "facebook", "gmail", "calendar"]),
          username: z.string().min(1),
          password: z.string().min(1),
        }),
      )
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const inserted: any[] = [];
    for (const cred of data) {
      const { data: row, error } = await supabase
        .from("vault_items")
        .insert({
          user_id: userId,
          kind: "credential",
          label: `Social: ${cred.platform}/${cred.username}`,
          tags: [cred.platform, "social"],
          data: {
            platform: cred.platform,
            username: cred.username,
            password: cred.password,
            note: `Imported from txt file. Use this to connect ${cred.platform}.`,
          },
        })
        .select("*")
        .single();
      if (error) throw error;
      inserted.push(row);
    }
    return inserted;
  });
