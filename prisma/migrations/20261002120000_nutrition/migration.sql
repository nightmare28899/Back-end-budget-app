-- Nutrition workspace: ported from the Supabase schema (admin-panel-budget/drizzle/0000_nutrition.sql).
-- Owners are text ids referencing users(id); no RLS/auth schema; SQL functions take owner_id_arg.

-- CreateTable
CREATE TABLE "nutrition_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "theme" TEXT NOT NULL DEFAULT 'light',
    "times" JSONB NOT NULL DEFAULT '{"breakfast":"08:00","morning_snack":"11:00","lunch":"14:00","afternoon_snack":"17:00","dinner":"20:00"}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_diets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "nutrition_diets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_diet_meals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diet_id" UUID NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "nutrition_diet_meals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_recipes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "image_url" TEXT,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "seed_key" TEXT,

    CONSTRAINT "nutrition_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_diet_meal_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meal_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "recipe_id" UUID,

    CONSTRAINT "nutrition_diet_meal_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_food_portions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "option_id" UUID,
    "recipe_id" UUID,
    "food_id" TEXT NOT NULL,
    "food_name" TEXT NOT NULL,
    "quantity" DECIMAL(24,12),
    "unit" TEXT NOT NULL DEFAULT '',
    "preparation" TEXT NOT NULL DEFAULT '',
    "free" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "nutrition_food_portions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_recipe_ingredients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipe_id" UUID NOT NULL,
    "portion_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "nutrition_recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_recipe_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipe_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "instruction" TEXT NOT NULL,

    CONSTRAINT "nutrition_recipe_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_recipe_videos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipe_id" UUID NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "nutrition_recipe_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_favorite_recipes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipe_id" UUID NOT NULL,

    CONSTRAINT "nutrition_favorite_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_daily_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diet_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "timezone" TEXT NOT NULL,

    CONSTRAINT "nutrition_daily_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_daily_meals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plan_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "nutrition_daily_meals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_meal_completions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meal_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_meal_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_diet_original_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diet_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "nutrition_diet_original_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_diets_owner_id_id_key" ON "nutrition_diets"("owner_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_diet_meals_owner_id_id_key" ON "nutrition_diet_meals"("owner_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_diet_meals_diet_id_type_key" ON "nutrition_diet_meals"("diet_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_recipes_owner_id_id_key" ON "nutrition_recipes"("owner_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_recipes_owner_id_seed_key_key" ON "nutrition_recipes"("owner_id", "seed_key");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_diet_meal_options_owner_id_id_key" ON "nutrition_diet_meal_options"("owner_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_food_portions_owner_id_id_key" ON "nutrition_food_portions"("owner_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_recipe_ingredients_portion_id_key" ON "nutrition_recipe_ingredients"("portion_id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_recipe_steps_recipe_id_position_key" ON "nutrition_recipe_steps"("recipe_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_favorite_recipes_owner_id_recipe_id_key" ON "nutrition_favorite_recipes"("owner_id", "recipe_id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_daily_plans_owner_id_id_key" ON "nutrition_daily_plans"("owner_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_daily_plans_owner_id_date_key" ON "nutrition_daily_plans"("owner_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_daily_meals_owner_id_id_key" ON "nutrition_daily_meals"("owner_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_daily_meals_plan_id_type_key" ON "nutrition_daily_meals"("plan_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_meal_completions_meal_id_key" ON "nutrition_meal_completions"("meal_id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_diet_original_files_path_key" ON "nutrition_diet_original_files"("path");

-- AddForeignKey
ALTER TABLE "nutrition_users" ADD CONSTRAINT "nutrition_users_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_diets" ADD CONSTRAINT "nutrition_diets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_diet_meals" ADD CONSTRAINT "nutrition_diet_meals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_diet_meals" ADD CONSTRAINT "nutrition_diet_meals_owner_id_diet_id_fkey" FOREIGN KEY ("owner_id", "diet_id") REFERENCES "nutrition_diets"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_recipes" ADD CONSTRAINT "nutrition_recipes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_diet_meal_options" ADD CONSTRAINT "nutrition_diet_meal_options_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_diet_meal_options" ADD CONSTRAINT "nutrition_diet_meal_options_owner_id_meal_id_fkey" FOREIGN KEY ("owner_id", "meal_id") REFERENCES "nutrition_diet_meals"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_diet_meal_options" ADD CONSTRAINT "nutrition_diet_meal_options_owner_id_recipe_id_fkey" FOREIGN KEY ("owner_id", "recipe_id") REFERENCES "nutrition_recipes"("owner_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_food_portions" ADD CONSTRAINT "nutrition_food_portions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_food_portions" ADD CONSTRAINT "nutrition_food_portions_owner_id_option_id_fkey" FOREIGN KEY ("owner_id", "option_id") REFERENCES "nutrition_diet_meal_options"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_food_portions" ADD CONSTRAINT "nutrition_food_portions_owner_id_recipe_id_fkey" FOREIGN KEY ("owner_id", "recipe_id") REFERENCES "nutrition_recipes"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_recipe_ingredients" ADD CONSTRAINT "nutrition_recipe_ingredients_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_recipe_ingredients" ADD CONSTRAINT "nutrition_recipe_ingredients_owner_id_recipe_id_fkey" FOREIGN KEY ("owner_id", "recipe_id") REFERENCES "nutrition_recipes"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_recipe_ingredients" ADD CONSTRAINT "nutrition_recipe_ingredients_owner_id_portion_id_fkey" FOREIGN KEY ("owner_id", "portion_id") REFERENCES "nutrition_food_portions"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_recipe_steps" ADD CONSTRAINT "nutrition_recipe_steps_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_recipe_steps" ADD CONSTRAINT "nutrition_recipe_steps_owner_id_recipe_id_fkey" FOREIGN KEY ("owner_id", "recipe_id") REFERENCES "nutrition_recipes"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_recipe_videos" ADD CONSTRAINT "nutrition_recipe_videos_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_recipe_videos" ADD CONSTRAINT "nutrition_recipe_videos_owner_id_recipe_id_fkey" FOREIGN KEY ("owner_id", "recipe_id") REFERENCES "nutrition_recipes"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_favorite_recipes" ADD CONSTRAINT "nutrition_favorite_recipes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_favorite_recipes" ADD CONSTRAINT "nutrition_favorite_recipes_owner_id_recipe_id_fkey" FOREIGN KEY ("owner_id", "recipe_id") REFERENCES "nutrition_recipes"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_daily_plans" ADD CONSTRAINT "nutrition_daily_plans_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_daily_plans" ADD CONSTRAINT "nutrition_daily_plans_owner_id_diet_id_fkey" FOREIGN KEY ("owner_id", "diet_id") REFERENCES "nutrition_diets"("owner_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_daily_meals" ADD CONSTRAINT "nutrition_daily_meals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_daily_meals" ADD CONSTRAINT "nutrition_daily_meals_owner_id_plan_id_fkey" FOREIGN KEY ("owner_id", "plan_id") REFERENCES "nutrition_daily_plans"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_meal_completions" ADD CONSTRAINT "nutrition_meal_completions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_meal_completions" ADD CONSTRAINT "nutrition_meal_completions_owner_id_meal_id_fkey" FOREIGN KEY ("owner_id", "meal_id") REFERENCES "nutrition_daily_meals"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_diet_original_files" ADD CONSTRAINT "nutrition_diet_original_files_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_diet_original_files" ADD CONSTRAINT "nutrition_diet_original_files_owner_id_diet_id_fkey" FOREIGN KEY ("owner_id", "diet_id") REFERENCES "nutrition_diets"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- CHECK constraints and the partial unique index (not representable in Prisma)
-- ---------------------------------------------------------------------------
ALTER TABLE "nutrition_users" ADD CONSTRAINT "nutrition_user_theme" CHECK ("theme" in ('light','dark'));
ALTER TABLE "nutrition_diets" ADD CONSTRAINT "nutrition_diet_dates" CHECK ("end_date" is null or "end_date" >= "start_date");
ALTER TABLE "nutrition_diets" ADD CONSTRAINT "nutrition_diet_status" CHECK ("status" in ('draft','pending_verification','verified') and (not "active" or "status" = 'verified'));
ALTER TABLE "nutrition_diet_meals" ADD CONSTRAINT "nutrition_meal_type_check" CHECK ("type" in ('breakfast','morning_snack','lunch','afternoon_snack','dinner'));
ALTER TABLE "nutrition_recipes" ADD CONSTRAINT "nutrition_recipe_type" CHECK ("type" in ('breakfast','morning_snack','lunch','afternoon_snack','dinner'));
ALTER TABLE "nutrition_recipes" ADD CONSTRAINT "nutrition_recipe_duration" CHECK ("duration" between 0 and 1440);
ALTER TABLE "nutrition_recipes" ADD CONSTRAINT "nutrition_recipe_image" CHECK ("image_url" is null or "image_url" ~ '^https://');
ALTER TABLE "nutrition_food_portions" ADD CONSTRAINT "nutrition_portion_parent" CHECK (num_nonnulls("option_id", "recipe_id") = 1);
ALTER TABLE "nutrition_food_portions" ADD CONSTRAINT "nutrition_portion_quantity" CHECK (("free" and "quantity" is null) or (not "free" and ("quantity" is null or ("quantity" > 0 and "unit" <> ''))));
ALTER TABLE "nutrition_recipe_videos" ADD CONSTRAINT "nutrition_video_url" CHECK ("url" ~ '^https://');
ALTER TABLE "nutrition_daily_meals" ADD CONSTRAINT "nutrition_daily_type" CHECK ("type" in ('breakfast','morning_snack','lunch','afternoon_snack','dinner'));
ALTER TABLE "nutrition_daily_meals" ADD CONSTRAINT "nutrition_daily_status" CHECK ("status" in ('pending','completed','skipped'));
ALTER TABLE "nutrition_diet_original_files" ADD CONSTRAINT "nutrition_original_size" CHECK ("size" between 1 and 5242880);
ALTER TABLE "nutrition_diet_original_files" ADD CONSTRAINT "nutrition_original_mime" CHECK ("mime" in ('image/jpeg','image/png','application/pdf'));
CREATE UNIQUE INDEX "nutrition_one_active_diet" ON "nutrition_diets" USING btree ("owner_id") WHERE "active";

-- ---------------------------------------------------------------------------
-- Functions. Ported from the Supabase migration: auth.uid() is replaced by an
-- explicit owner_id_arg text first parameter; every function is SECURITY INVOKER
-- (the NestJS service is the only caller and always passes the JWT user id).
-- ---------------------------------------------------------------------------
CREATE FUNCTION nutrition_text_length(value text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(sum(CASE WHEN ascii(substr(value,i,1))>65535 THEN 2 ELSE 1 END),0)::integer FROM generate_series(1,char_length(value)) i;
$$;

CREATE FUNCTION nutrition_text(value jsonb, maximum integer, allow_empty boolean DEFAULT false) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result text:=value #>> '{}';
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR char_length(result)>maximum OR public.nutrition_text_length(result)>maximum OR (NOT allow_empty AND btrim(result)='') THEN RAISE EXCEPTION 'Invalid bounded text'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION nutrition_uuid(value jsonb) RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result text:=value #>> '{}';
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR (result !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND lower(result) NOT IN ('00000000-0000-0000-0000-000000000000','ffffffff-ffff-ffff-ffff-ffffffffffff')) THEN RAISE EXCEPTION 'Invalid UUID'; END IF;
 RETURN result::uuid;
END $$;

CREATE FUNCTION nutrition_portion_keys(items jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(k ORDER BY k::text),'[]') FROM (SELECT jsonb_build_array(x->>'foodId',
 CASE WHEN coalesce((x->>'free')::boolean,false) THEN NULL ELSE (x->>'quantity')::numeric END,
 x->>'unit',x->>'preparation',coalesce((x->>'free')::boolean,false)) k FROM jsonb_array_elements(items) x) a;
$$;

CREATE FUNCTION nutrition_validate_portions(items jsonb, executable boolean) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x jsonb;
BEGIN
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Ingredients required'; END IF;
  IF jsonb_array_length(items) NOT BETWEEN 1 AND 30 OR (SELECT count(DISTINCT element->>'id') FROM jsonb_array_elements(items) element)<>jsonb_array_length(items) THEN RAISE EXCEPTION 'Unique ingredients required'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(items) LOOP
   PERFORM public.nutrition_uuid(x->'id');
   PERFORM public.nutrition_text(x->'foodId',100); PERFORM public.nutrition_text(x->'foodName',120);
   PERFORM public.nutrition_text(x->'unit',40,true); PERFORM public.nutrition_text(x->'preparation',300,true);
   IF jsonb_typeof(x->'free') IS DISTINCT FROM 'boolean' OR x->'quantity' IS NULL OR jsonb_typeof(x->'quantity') NOT IN ('string','null') THEN RAISE EXCEPTION 'Invalid portion fields'; END IF;
  IF (x->>'free')::boolean THEN
   IF x->>'quantity' IS NOT NULL THEN RAISE EXCEPTION 'Free foods must have no quantity'; END IF;
  ELSE
   IF executable AND x->>'quantity' IS NULL THEN RAISE EXCEPTION 'Verify unknown portions first'; END IF;
   IF x->>'quantity' IS NOT NULL AND (x->>'quantity' !~ '^\d{1,12}(\.\d{1,12})?$' OR (x->>'quantity')::numeric <= 0 OR coalesce(x->>'unit','')='') THEN RAISE EXCEPTION 'Invalid exact portion'; END IF;
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION nutrition_portions(owner_id_arg text, option_id_arg uuid DEFAULT NULL, recipe_id_arg uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'foodId',food_id,'foodName',food_name,
 'quantity',quantity::text,'unit',unit,'preparation',preparation,'free',free) ORDER BY position), '[]')
  FROM public.nutrition_food_portions WHERE owner_id=owner_id_arg
 AND ((option_id_arg IS NOT NULL AND option_id=option_id_arg) OR (recipe_id_arg IS NOT NULL AND recipe_id=recipe_id_arg));
$$;

CREATE FUNCTION nutrition_recipe_json(owner_id_arg text, recipe_id_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT jsonb_build_object('id',r.id,'title',r.title,'type',r.type,'duration',r.duration,'notes',r.notes,
  'imageUrl',r.image_url,'demo',r.demo,'seedKey',r.seed_key,'favorite',EXISTS(SELECT 1 FROM public.nutrition_favorite_recipes f WHERE f.recipe_id=r.id AND f.owner_id=owner_id_arg),
  'ingredients',public.nutrition_portions(owner_id_arg,NULL,r.id),'steps',coalesce((SELECT jsonb_agg(instruction ORDER BY position) FROM public.nutrition_recipe_steps WHERE recipe_id=r.id AND owner_id=owner_id_arg),'[]'))
  FROM public.nutrition_recipes r WHERE r.id=recipe_id_arg AND r.owner_id=owner_id_arg;
$$;

CREATE FUNCTION nutrition_recipe_matches(owner_id_arg text, recipe_id_arg uuid, items jsonb, meal_type_arg text) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce((SELECT NOT r.demo AND r.type=meal_type_arg AND public.nutrition_portion_keys(public.nutrition_portions(owner_id_arg,NULL,r.id))=public.nutrition_portion_keys(items)
 AND NOT EXISTS(SELECT 1 FROM public.nutrition_food_portions fp WHERE fp.recipe_id=r.id AND fp.owner_id=owner_id_arg AND NOT fp.free AND fp.quantity IS NULL)
 FROM public.nutrition_recipes r WHERE r.id=recipe_id_arg AND r.owner_id=owner_id_arg),false);
$$;

CREATE FUNCTION nutrition_insert_portions(owner_id_arg text, items jsonb, option_id_arg uuid, recipe_id_arg uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE x jsonb; n integer:=0; portion_id uuid;
BEGIN
  IF owner_id_arg IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF (option_id_arg IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.nutrition_diet_meal_options WHERE id=option_id_arg AND owner_id=owner_id_arg)) OR (recipe_id_arg IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.nutrition_recipes WHERE id=recipe_id_arg AND owner_id=owner_id_arg)) THEN RAISE EXCEPTION 'Portion parent unavailable'; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(items) LOOP
  portion_id:=(x->>'id')::uuid;
   INSERT INTO public.nutrition_food_portions(id,owner_id,option_id,recipe_id,food_id,food_name,quantity,unit,preparation,free,position)
  VALUES(portion_id,owner_id_arg,option_id_arg,recipe_id_arg,x->>'foodId',x->>'foodName',(x->>'quantity')::numeric,x->>'unit',x->>'preparation',(x->>'free')::boolean,n);
   IF recipe_id_arg IS NOT NULL THEN INSERT INTO public.nutrition_recipe_ingredients(owner_id,recipe_id,portion_id,position) VALUES(owner_id_arg,recipe_id_arg,portion_id,n); END IF;
  n:=n+1;
 END LOOP;
END $$;

CREATE FUNCTION nutrition_snapshot_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE recipe jsonb;
BEGIN
 IF OLD.plan_id<>NEW.plan_id OR OLD.type<>NEW.type OR OLD.time<>NEW.time OR OLD.owner_id<>NEW.owner_id
 OR OLD.snapshot->'ingredients' IS DISTINCT FROM NEW.snapshot->'ingredients'
 OR OLD.snapshot->'optionId' IS DISTINCT FROM NEW.snapshot->'optionId' THEN RAISE EXCEPTION 'Daily diet snapshots are immutable'; END IF;
 IF OLD.snapshot IS DISTINCT FROM NEW.snapshot THEN
   IF OLD.status<>'pending' OR NOT public.nutrition_recipe_matches(NEW.owner_id,(NEW.snapshot->>'recipeId')::uuid,OLD.snapshot->'ingredients',OLD.type) THEN RAISE EXCEPTION 'Recipe selection is unavailable'; END IF;
   recipe:=public.nutrition_recipe_json(NEW.owner_id,(NEW.snapshot->>'recipeId')::uuid);
   IF NEW.snapshot IS DISTINCT FROM (OLD.snapshot || jsonb_build_object('recipeId',recipe->'id','title',recipe->'title','steps',recipe->'steps')) THEN RAISE EXCEPTION 'Only an exact recipe selection may change a snapshot'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nutrition_snapshot_guard BEFORE UPDATE ON nutrition_daily_meals FOR EACH ROW EXECUTE FUNCTION nutrition_snapshot_guard();

-- Returns the whole workspace state for one owner. Creates the nutrition profile
-- on first access, named after the backend user (fallback 'You').
CREATE FUNCTION nutrition_state(owner_id_arg text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE result jsonb; uid text:=owner_id_arg; initial_name text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT nullif(btrim(left(u.name,100)),'') INTO initial_name FROM public.users u WHERE u.id=uid;
  initial_name:=coalesce(initial_name,'You');
  WHILE public.nutrition_text_length(initial_name)>100 LOOP initial_name:=left(initial_name,char_length(initial_name)-1); END LOOP;
  INSERT INTO public.nutrition_users(id,name) VALUES(uid,initial_name) ON CONFLICT(id) DO NOTHING;
  SELECT jsonb_build_object('profile', (SELECT jsonb_build_object('id',id,'name',name,'timezone',timezone,'times',times,'theme',theme) FROM public.nutrition_users WHERE id=uid),
  'diets',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'startDate',d.start_date,'endDate',d.end_date,'status',d.status,'active',d.active,
  'meals',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'type',m.type,'options',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'title',o.title,'notes',o.notes,'recipeId',o.recipe_id,'portions',public.nutrition_portions(uid,o.id,NULL)) ORDER BY o.position) FROM public.nutrition_diet_meal_options o WHERE o.meal_id=m.id AND o.owner_id=uid),'[]')) ORDER BY array_position(ARRAY['breakfast','morning_snack','lunch','afternoon_snack','dinner'],m.type)) FROM public.nutrition_diet_meals m WHERE m.diet_id=d.id AND m.owner_id=uid),'[]')) ORDER BY d.created_at DESC) FROM public.nutrition_diets d WHERE d.owner_id=uid),'[]'),
  'recipes',coalesce((SELECT jsonb_agg(public.nutrition_recipe_json(uid,id) ORDER BY created_at DESC) FROM public.nutrition_recipes WHERE owner_id=uid),'[]'),
  'plans',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'date',p.date,'timezone',p.timezone,'dietId',p.diet_id,'meals',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'type',m.type,'time',m.time,'snapshot',m.snapshot,'status',m.status,'completedAt',(SELECT completed_at FROM public.nutrition_meal_completions WHERE meal_id=m.id AND owner_id=uid)) ORDER BY array_position(ARRAY['breakfast','morning_snack','lunch','afternoon_snack','dinner'],m.type)) FROM public.nutrition_daily_meals m WHERE m.plan_id=p.id AND m.owner_id=uid),'[]'))) FROM public.nutrition_daily_plans p WHERE p.owner_id=uid),'[]'),
  'files',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'dietId',diet_id,'name',name,'mime',mime,'size',size,'createdAt',created_at)) FROM public.nutrition_diet_original_files WHERE owner_id=uid),'[]')) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION nutrition_command(owner_id_arg text, command text, payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE uid text:=owner_id_arg; item_id uuid; meal jsonb; opt jsonb; step text; pos integer; recipe jsonb; d public.nutrition_diets; m public.nutrition_daily_meals; generated_plan_id uuid; current_day date; p public.nutrition_users; selected_option public.nutrition_diet_meal_options; recipe_id_arg uuid; diet_id_arg uuid;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF command IS NULL OR command NOT IN ('save_diet','verify_diet','activate_diet','save_recipe','delete_recipe','favorite','settings','generate_plan','completion','choose_recipe','original_file') THEN RAISE EXCEPTION 'Unsupported operation'; END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text)>1048576 THEN RAISE EXCEPTION 'Invalid bounded payload'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 PERFORM public.nutrition_state(uid);
 IF command NOT IN ('generate_plan','settings') THEN item_id:=public.nutrition_uuid(payload->'id'); END IF;
 IF command='save_diet' THEN
   PERFORM public.nutrition_text(payload->'title',120);
   IF jsonb_typeof(payload->'meals') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Five unique meal types required'; END IF;
   IF jsonb_array_length(payload->'meals')<>5 OR (SELECT count(DISTINCT x->>'type') FROM jsonb_array_elements(payload->'meals') x)<>5 THEN RAISE EXCEPTION 'Five unique meal types required'; END IF;
   IF coalesce(payload->>'status','') NOT IN ('draft','pending_verification') THEN RAISE EXCEPTION 'Save a draft before verification'; END IF;
   IF public.nutrition_text(payload->'startDate',10) !~ '^\d{4}-\d{2}-\d{2}$' OR payload->'endDate' IS NULL OR (payload->'endDate'<>'null'::jsonb AND public.nutrition_text(payload->'endDate',10) !~ '^\d{4}-\d{2}-\d{2}$') THEN RAISE EXCEPTION 'Invalid diet dates'; END IF;
   INSERT INTO public.nutrition_diets(id,owner_id,title,start_date,end_date,status,active) VALUES(item_id,uid,payload->>'title',(payload->>'startDate')::date,(payload->>'endDate')::date,'draft',false)
   ON CONFLICT(id) DO UPDATE SET title=excluded.title,start_date=excluded.start_date,end_date=excluded.end_date,status='draft',active=false,updated_at=now() WHERE nutrition_diets.owner_id=uid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Diet unavailable'; END IF;
   DELETE FROM public.nutrition_diet_meals WHERE diet_id=item_id AND owner_id=uid;
   FOR meal IN SELECT value FROM jsonb_array_elements(payload->'meals') LOOP
    IF jsonb_typeof(meal->'options') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid meal options'; END IF;
    IF jsonb_array_length(meal->'options')>12 THEN RAISE EXCEPTION 'Too many meal options'; END IF;
    INSERT INTO public.nutrition_diet_meals(id,owner_id,diet_id,type) VALUES(public.nutrition_uuid(meal->'id'),uid,item_id,public.nutrition_text(meal->'type',30)); pos:=0;
    FOR opt IN SELECT value FROM jsonb_array_elements(meal->'options') LOOP
     PERFORM public.nutrition_validate_portions(opt->'portions',false);
     IF opt->'recipeId' IS NULL THEN RAISE EXCEPTION 'Invalid recipe association'; END IF;
     recipe_id_arg:=CASE WHEN opt->'recipeId'='null'::jsonb THEN NULL ELSE public.nutrition_uuid(opt->'recipeId') END;
     IF recipe_id_arg IS NOT NULL AND NOT public.nutrition_recipe_matches(uid,recipe_id_arg,opt->'portions',meal->>'type') THEN RAISE EXCEPTION 'Recipe must match exact prescribed portions and preparation'; END IF;
     INSERT INTO public.nutrition_diet_meal_options(id,owner_id,meal_id,title,notes,position,recipe_id) VALUES(public.nutrition_uuid(opt->'id'),uid,(meal->>'id')::uuid,public.nutrition_text(opt->'title',120),public.nutrition_text(opt->'notes',2000,true),pos,recipe_id_arg);
     PERFORM public.nutrition_insert_portions(uid,opt->'portions',(opt->>'id')::uuid,NULL); pos:=pos+1;
   END LOOP;
  END LOOP;
 ELSIF command IN ('verify_diet','activate_diet') THEN
   IF command='verify_diet' AND payload->'acknowledged' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Confirm the manual transcription first'; END IF;
   SELECT * INTO d FROM public.nutrition_diets WHERE id=item_id AND owner_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Diet unavailable'; END IF;
   IF (SELECT count(*) FROM public.nutrition_diet_meals WHERE diet_id=item_id AND owner_id=uid)<>5 THEN RAISE EXCEPTION 'Five meals required'; END IF;
   FOR meal IN SELECT to_jsonb(x) FROM public.nutrition_diet_meals x WHERE diet_id=item_id AND owner_id=uid LOOP
    IF NOT EXISTS(SELECT 1 FROM public.nutrition_diet_meal_options WHERE meal_id=(meal->>'id')::uuid AND owner_id=uid) THEN RAISE EXCEPTION 'Each meal needs an option'; END IF;
    FOR selected_option IN SELECT * FROM public.nutrition_diet_meal_options WHERE meal_id=(meal->>'id')::uuid AND owner_id=uid LOOP
     PERFORM public.nutrition_validate_portions(public.nutrition_portions(uid,selected_option.id,NULL),true);
     IF selected_option.recipe_id IS NOT NULL AND NOT public.nutrition_recipe_matches(uid,selected_option.recipe_id,public.nutrition_portions(uid,selected_option.id,NULL),meal->>'type') THEN RAISE EXCEPTION 'Associated recipe no longer matches'; END IF;
   END LOOP;
  END LOOP;
  IF command='activate_diet' AND d.status<>'verified' THEN RAISE EXCEPTION 'Verify transcription before activation'; END IF;
   IF command='activate_diet' THEN UPDATE public.nutrition_diets SET active=false WHERE owner_id=uid AND active; END IF;
   UPDATE public.nutrition_diets SET status='verified',active=(command='activate_diet'),updated_at=now() WHERE id=item_id AND owner_id=uid;
  ELSIF command='save_recipe' THEN
   PERFORM public.nutrition_text(payload->'title',120);
   PERFORM public.nutrition_text(payload->'notes',3000,true);
   IF jsonb_typeof(payload->'demo') IS DISTINCT FROM 'boolean' OR jsonb_typeof(payload->'duration') IS DISTINCT FROM 'number' OR payload->>'duration' !~ '^\d{1,4}$' OR (payload->>'duration')::integer>1440 THEN RAISE EXCEPTION 'Invalid recipe metadata'; END IF;
   IF payload->'seedKey' IS NULL OR payload->'imageUrl' IS NULL THEN RAISE EXCEPTION 'Invalid nullable recipe fields'; END IF;
   IF payload->'seedKey'<>'null'::jsonb THEN PERFORM public.nutrition_text(payload->'seedKey',100,true); END IF;
   IF payload->'imageUrl'<>'null'::jsonb THEN
    PERFORM public.nutrition_text(payload->'imageUrl',2048);
    IF payload->>'imageUrl' !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z])?([/?#][^[:space:]]*)?$' THEN RAISE EXCEPTION 'Use an HTTPS image URL with a DNS host'; END IF;
   END IF;
   PERFORM public.nutrition_validate_portions(payload->'ingredients',NOT (payload->>'demo')::boolean);
  FOR opt IN SELECT value FROM jsonb_array_elements(payload->'ingredients') LOOP
    IF (opt->>'free')::boolean AND NOT EXISTS(SELECT 1 FROM public.nutrition_food_portions fp WHERE fp.owner_id=uid AND fp.option_id IS NOT NULL AND fp.free AND fp.food_id=opt->>'foodId' AND fp.unit=opt->>'unit' AND fp.preparation=opt->>'preparation') THEN RAISE EXCEPTION 'Explicit diet allowance required for free food'; END IF;
  END LOOP;
   IF jsonb_typeof(payload->'steps') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Preparation steps required'; END IF;
   IF jsonb_array_length(payload->'steps') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Preparation steps required'; END IF;
   FOR opt IN SELECT value FROM jsonb_array_elements(payload->'steps') LOOP PERFORM public.nutrition_text(opt,2000); END LOOP;
   IF payload->>'seedKey' IS NOT NULL AND EXISTS(SELECT 1 FROM public.nutrition_recipes WHERE owner_id=uid AND seed_key=payload->>'seedKey') THEN RETURN '{}'::jsonb; END IF;
   INSERT INTO public.nutrition_recipes(id,owner_id,title,type,duration,notes,image_url,demo,seed_key) VALUES(item_id,uid,payload->>'title',public.nutrition_text(payload->'type',30),(payload->>'duration')::integer,payload->>'notes',payload->>'imageUrl',(payload->>'demo')::boolean,payload->>'seedKey')
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,type=excluded.type,duration=excluded.duration,notes=excluded.notes,image_url=excluded.image_url,demo=excluded.demo,updated_at=now() WHERE nutrition_recipes.owner_id=uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipe unavailable'; END IF;
   DELETE FROM public.nutrition_food_portions WHERE recipe_id=item_id AND owner_id=uid; DELETE FROM public.nutrition_recipe_steps WHERE recipe_id=item_id AND owner_id=uid;
   PERFORM public.nutrition_insert_portions(uid,payload->'ingredients',NULL,item_id); pos:=0;
   FOR step IN SELECT jsonb_array_elements_text(payload->'steps') LOOP INSERT INTO public.nutrition_recipe_steps(owner_id,recipe_id,position,instruction) VALUES(uid,item_id,pos,step); pos:=pos+1; END LOOP;
   UPDATE public.nutrition_diets SET status='draft',active=false WHERE owner_id=uid AND id IN(SELECT dm.diet_id FROM public.nutrition_diet_meals dm JOIN public.nutrition_diet_meal_options o ON o.meal_id=dm.id AND o.owner_id=uid WHERE dm.owner_id=uid AND o.recipe_id=item_id AND NOT public.nutrition_recipe_matches(uid,item_id,public.nutrition_portions(uid,o.id,NULL),dm.type));
  ELSIF command='delete_recipe' THEN
   IF NOT EXISTS(SELECT 1 FROM public.nutrition_recipes WHERE id=item_id AND owner_id=uid) THEN RAISE EXCEPTION 'Recipe unavailable'; END IF;
   UPDATE public.nutrition_diet_meal_options SET recipe_id=NULL WHERE recipe_id=item_id AND owner_id=uid;
   DELETE FROM public.nutrition_recipes WHERE id=item_id AND owner_id=uid;
  ELSIF command='favorite' THEN
   IF jsonb_typeof(payload->'favorite') IS DISTINCT FROM 'boolean' OR NOT EXISTS(SELECT 1 FROM public.nutrition_recipes WHERE id=item_id AND owner_id=uid) THEN RAISE EXCEPTION 'Favorite recipe unavailable'; END IF;
   IF (payload->>'favorite')::boolean THEN INSERT INTO public.nutrition_favorite_recipes(owner_id,recipe_id) VALUES(uid,item_id) ON CONFLICT(owner_id,recipe_id) DO NOTHING;
   ELSE DELETE FROM public.nutrition_favorite_recipes WHERE owner_id=uid AND recipe_id=item_id; END IF;
  ELSIF command='settings' THEN
   IF payload->>'id' IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Profile unavailable'; END IF;
   PERFORM public.nutrition_text(payload->'name',100);
   IF coalesce(payload->>'theme','') NOT IN ('light','dark') OR payload->>'timezone' IN ('Factory','localtime') OR payload->>'timezone' ~ '^(posix|right)/' OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=payload->>'timezone') THEN RAISE EXCEPTION 'Invalid profile settings'; END IF;
   IF jsonb_typeof(payload->'times') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Five meal times required'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(payload->'times'))<>5 THEN RAISE EXCEPTION 'Five meal times required'; END IF;
  FOR step IN SELECT unnest(ARRAY['breakfast','morning_snack','lunch','afternoon_snack','dinner']) LOOP IF coalesce(payload->'times'->>step,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Invalid meal time'; END IF; END LOOP;
   UPDATE public.nutrition_users SET name=payload->>'name',timezone=payload->>'timezone',times=payload->'times',theme=payload->>'theme',updated_at=now() WHERE id=uid;
 ELSIF command='generate_plan' THEN
   SELECT * INTO p FROM public.nutrition_users WHERE id=uid;
  current_day:=(now() AT TIME ZONE p.timezone)::date;
   IF EXISTS(SELECT 1 FROM public.nutrition_daily_plans WHERE owner_id=uid AND date=current_day) THEN RETURN '{}'::jsonb; END IF;
   SELECT * INTO d FROM public.nutrition_diets WHERE owner_id=uid AND active AND status='verified' AND start_date<=current_day AND (end_date IS NULL OR end_date>=current_day);
  IF NOT FOUND THEN RAISE EXCEPTION 'Activate a verified diet covering today first'; END IF;
   generated_plan_id:=gen_random_uuid(); INSERT INTO public.nutrition_daily_plans(id,owner_id,diet_id,date,timezone) VALUES(generated_plan_id,uid,d.id,current_day,p.timezone);
   FOR meal IN SELECT to_jsonb(x) FROM public.nutrition_diet_meals x WHERE diet_id=d.id AND owner_id=uid LOOP
    SELECT * INTO selected_option FROM public.nutrition_diet_meal_options WHERE meal_id=(meal->>'id')::uuid AND owner_id=uid ORDER BY position LIMIT 1;
   IF NOT FOUND THEN RAISE EXCEPTION 'Verified meal option required'; END IF;
    PERFORM public.nutrition_validate_portions(public.nutrition_portions(uid,selected_option.id,NULL),true);
    recipe:=public.nutrition_recipe_json(uid,selected_option.recipe_id);
    IF selected_option.recipe_id IS NOT NULL AND NOT public.nutrition_recipe_matches(uid,selected_option.recipe_id,public.nutrition_portions(uid,selected_option.id,NULL),meal->>'type') THEN RAISE EXCEPTION 'Recipe no longer matches'; END IF;
    INSERT INTO public.nutrition_daily_meals(owner_id,plan_id,type,time,snapshot) VALUES(uid,generated_plan_id,meal->>'type',p.times->>(meal->>'type'),jsonb_build_object('title',coalesce(recipe->>'title',selected_option.title),'optionId',selected_option.id,'recipeId',selected_option.recipe_id,'ingredients',public.nutrition_portions(uid,selected_option.id,NULL),'steps',coalesce(recipe->'steps','[]'::jsonb),'notes',selected_option.notes));
  END LOOP;
   IF (SELECT count(*) FROM public.nutrition_daily_meals WHERE plan_id=generated_plan_id AND owner_id=uid)<>5 THEN RAISE EXCEPTION 'Five daily meals required'; END IF;
 ELSIF command IN ('completion','choose_recipe') THEN
   SELECT * INTO m FROM public.nutrition_daily_meals WHERE id=item_id AND owner_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meal unavailable'; END IF;
  IF command='completion' THEN
    IF coalesce(payload->>'status','') NOT IN ('pending','completed','skipped') THEN RAISE EXCEPTION 'Invalid status'; END IF;
    UPDATE public.nutrition_daily_meals SET status=payload->>'status',updated_at=now() WHERE id=item_id AND owner_id=uid;
    IF payload->>'status'='completed' THEN INSERT INTO public.nutrition_meal_completions(owner_id,meal_id) VALUES(uid,item_id) ON CONFLICT(meal_id) DO NOTHING;
    ELSE DELETE FROM public.nutrition_meal_completions WHERE owner_id=uid AND meal_id=item_id; END IF;
  ELSE
    recipe_id_arg:=public.nutrition_uuid(payload->'recipeId');
    IF m.status<>'pending' OR NOT public.nutrition_recipe_matches(uid,recipe_id_arg,m.snapshot->'ingredients',m.type) THEN RAISE EXCEPTION 'Choose a matching recipe for a pending meal'; END IF;
    recipe:=public.nutrition_recipe_json(uid,recipe_id_arg);
    UPDATE public.nutrition_daily_meals SET snapshot=snapshot || jsonb_build_object('recipeId',recipe->'id','title',recipe->'title','steps',recipe->'steps') WHERE id=item_id AND owner_id=uid;
  END IF;
 ELSIF command='original_file' THEN
   diet_id_arg:=public.nutrition_uuid(payload->'dietId');
   IF NOT EXISTS(SELECT 1 FROM public.nutrition_diets WHERE id=diet_id_arg AND owner_id=uid) THEN RAISE EXCEPTION 'Diet unavailable'; END IF;
   PERFORM public.nutrition_text(payload->'name',200);
   IF coalesce(payload->>'path','') <> 'nutrition/'||uid||'/'||item_id::text THEN RAISE EXCEPTION 'Retained private object required'; END IF;
   IF coalesce(payload->>'mime','') NOT IN ('image/jpeg','image/png','application/pdf') OR coalesce(payload->>'hash','') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(payload->'size') IS DISTINCT FROM 'number' OR payload->>'size' !~ '^\d{1,7}$' THEN RAISE EXCEPTION 'Invalid original metadata'; END IF;
   INSERT INTO public.nutrition_diet_original_files(id,owner_id,diet_id,path,name,mime,size,hash) VALUES(item_id,uid,diet_id_arg,payload->>'path',payload->>'name',payload->>'mime',(payload->>'size')::integer,payload->>'hash');
   UPDATE public.nutrition_diets SET status='pending_verification',active=false WHERE owner_id=uid AND id=diet_id_arg;
 ELSE RAISE EXCEPTION 'Unsupported operation'; END IF;
 RETURN '{}'::jsonb;
END $$;

