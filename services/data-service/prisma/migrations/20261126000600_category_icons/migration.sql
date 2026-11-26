-- Every default category gets a real icon (keys from frontend/shared/categoryIcons.ts).
-- Icons stored by earlier versions move to the current keys; categories that
-- never had one chosen ("category", or "trip" for trip categories) get the
-- icon for their name when it's a well-known one.
UPDATE "categories" SET "icon" = CASE "icon"
    WHEN 'shopping_cart' THEN 'shopping-cart'
    WHEN 'restaurant' THEN 'utensils'
    WHEN 'directions_car' THEN 'bus'
    WHEN 'bolt' THEN 'zap'
    WHEN 'movie' THEN 'film'
    WHEN 'shopping_bag' THEN 'shopping-bag'
    WHEN 'local_hospital' THEN 'heart-pulse'
    WHEN 'attach_money' THEN 'banknote'
    WHEN 'swap_horiz' THEN 'arrow-right-left'
    WHEN 'arrow-left-right' THEN 'arrow-right-left'
    WHEN 'label' THEN 'tag'
    WHEN 'dollar-sign' THEN 'banknote'
  END
WHERE "icon" IN ('shopping_cart', 'restaurant', 'directions_car', 'bolt', 'movie', 'shopping_bag',
  'local_hospital', 'attach_money', 'swap_horiz', 'arrow-left-right', 'label', 'dollar-sign');

UPDATE "categories" c SET "icon" = n."icon"
FROM (VALUES
    ('groceries', 'shopping-cart'),
    ('dining', 'utensils'),
    ('food & dining', 'utensils'),
    ('food', 'utensils'),
    ('coffee', 'coffee'),
    ('transportation', 'bus'),
    ('transport', 'bus'),
    ('car', 'car'),
    ('fuel', 'fuel'),
    ('petrol', 'fuel'),
    ('flights', 'plane'),
    ('travel', 'luggage'),
    ('accommodation', 'bed'),
    ('attractions', 'ticket'),
    ('fees', 'coins'),
    ('utilities', 'zap'),
    ('bills & utilities', 'zap'),
    ('bills', 'file-text'),
    ('telco', 'smartphone'),
    ('phone', 'smartphone'),
    ('housing', 'home'),
    ('rent', 'home'),
    ('entertainment', 'film'),
    ('games', 'gamepad'),
    ('gaming', 'gamepad'),
    ('music', 'music'),
    ('shopping', 'shopping-bag'),
    ('clothing', 'shirt'),
    ('clothes', 'shirt'),
    ('tech', 'laptop'),
    ('essentials', 'package'),
    ('gift', 'gift'),
    ('gifts', 'gift'),
    ('health', 'heart-pulse'),
    ('healthcare', 'heart-pulse'),
    ('medical', 'heart-pulse'),
    ('fitness', 'dumbbell'),
    ('activity', 'dumbbell'),
    ('sports', 'dumbbell'),
    ('bouldering', 'mountain'),
    ('personal care', 'user'),
    ('pets', 'paw'),
    ('kids', 'baby'),
    ('education', 'graduation-cap'),
    ('books', 'book'),
    ('insurance', 'shield'),
    ('subscriptions', 'repeat'),
    ('income', 'banknote'),
    ('salary', 'banknote'),
    ('cashback', 'badge-percent'),
    ('rewards', 'badge-percent'),
    ('investments', 'trending-up'),
    ('govt handouts', 'landmark'),
    ('government', 'landmark'),
    ('taxes', 'landmark'),
    ('charity', 'heart'),
    ('donations', 'heart'),
    ('gambling', 'dices'),
    ('ai', 'sparkles'),
    ('reimbursement', 'receipt'),
    ('transfers', 'arrow-right-left'),
    ('internal', 'arrow-right-left'),
    ('other', 'shapes'),
    ('uncategorized', 'tag')
) AS n("name", "icon")
WHERE lower(btrim(c."name")) = n."name" AND c."icon" IN ('category', 'trip', '');
