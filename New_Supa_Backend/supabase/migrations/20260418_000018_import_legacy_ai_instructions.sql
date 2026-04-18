-- Import premium AI instructions from the legacy backend table into the v2 AI system.
-- Safe to run even when the legacy table is absent.
DO $$
BEGIN
  IF to_regclass('public.premium_ai_quiz_instructions') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO public.ai_instructions (
        name,
        scope,
        system_prompt,
        user_prompt_template,
        input_schema,
        output_schema,
        is_active,
        created_at,
        updated_at
      )
      SELECT
        legacy.content_type,
        CASE legacy.content_type
          WHEN 'premium_gk_quiz' THEN 'gk'
          WHEN 'premium_maths_quiz' THEN 'maths'
          WHEN 'premium_passage_quiz' THEN 'passage'
          WHEN 'mains_question_generation' THEN 'mains'
          WHEN 'mains_evaluation' THEN 'evaluation'
          ELSE 'gk'
        END AS scope,
        COALESCE(legacy.system_instructions, ''),
        jsonb_build_object(
          'legacy_premium_ai_quiz_instruction_id', legacy.id,
          'ai_provider', COALESCE(NULLIF(legacy.ai_provider, ''), 'gemini'),
          'ai_model_name', COALESCE(NULLIF(legacy.ai_model_name, ''), 'gemini-3-flash-preview'),
          'example_input', legacy.example_input,
          'example_output', COALESCE(legacy.example_output, '{}'::jsonb),
          'style_analysis_system_prompt', legacy.style_analysis_system_prompt
        )::text,
        COALESCE(legacy.input_schema, '{}'::jsonb),
        COALESCE(legacy.output_schema, '{}'::jsonb),
        TRUE,
        COALESCE(legacy.created_at, NOW()),
        COALESCE(legacy.updated_at, legacy.created_at, NOW())
      FROM public.premium_ai_quiz_instructions legacy
      WHERE legacy.content_type IN (
        'premium_gk_quiz',
        'premium_maths_quiz',
        'premium_passage_quiz',
        'mains_question_generation',
        'mains_evaluation'
      )
      AND COALESCE(legacy.system_instructions, '') <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.ai_instructions existing
        WHERE existing.name = legacy.content_type
          AND existing.scope = CASE legacy.content_type
            WHEN 'premium_gk_quiz' THEN 'gk'
            WHEN 'premium_maths_quiz' THEN 'maths'
            WHEN 'premium_passage_quiz' THEN 'passage'
            WHEN 'mains_question_generation' THEN 'mains'
            WHEN 'mains_evaluation' THEN 'evaluation'
            ELSE 'gk'
          END
          AND existing.system_prompt = COALESCE(legacy.system_instructions, '')
      );
    $sql$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
