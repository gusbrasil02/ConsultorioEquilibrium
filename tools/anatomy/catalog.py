"""
Catálogo das estruturas do BodyParts3D usadas na anatomia real.

Para cada nome (em inglês, sem o lado) diz em que camada a peça entra, o tecido
(cor/material no visualizador), o nome em português e, quando existe, a chave
do músculo em public/js/muscle-data.js ou do órgão (Zang-Fu) da acupuntura.

    T['femur'] = ('bones', 'bone', 'Fêmur', 'm')

Gênero ('m', 'f', 'mp', 'fp') decide "direito/direita/direitos/direitas".
Peças fora do catálogo são ignoradas pelo gerador.
"""
import re

T = {}


def add(layer, kind, items):
    for en, pt, g in items:
        T[en] = (layer, kind, pt, g)


# ─── Ossos ────────────────────────────────────────────────────────────────────
ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']
PT_ORD = ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª', '7ª', '8ª', '9ª', '10ª', '11ª', '12ª']
PT_ORDM = ['1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º', '9º', '10º', '11º', '12º']

add('bones', 'bone', [
    ('femur', 'Fêmur', 'm'), ('tibia', 'Tíbia', 'f'), ('fibula', 'Fíbula', 'f'), ('patella', 'Patela (rótula)', 'f'),
    ('humerus', 'Úmero', 'm'), ('radius', 'Rádio', 'm'), ('ulna', 'Ulna', 'f'), ('scapula', 'Escápula', 'f'),
    ('clavicle', 'Clavícula', 'f'), ('hip bone', 'Osso do quadril (ilíaco)', 'm'), ('sacrum', 'Sacro', 'm'),
    ('talus', 'Tálus', 'm'), ('calcaneus', 'Calcâneo', 'm'), ('navicular bone of foot', 'Navicular', 'm'),
    ('cuboid bone', 'Cuboide', 'm'), ('medial cuneiform bone', 'Cuneiforme medial', 'm'),
    ('intermediate cuneiform bone', 'Cuneiforme intermédio', 'm'), ('lateral cuneiform bone', 'Cuneiforme lateral', 'm'),
    ('sesamoid bone of foot', 'Sesamoide do pé', 'm'),
    ('scaphoid', 'Escafoide', 'm'), ('lunate', 'Semilunar', 'm'), ('triquetral', 'Piramidal', 'm'), ('pisiform', 'Pisiforme', 'm'),
    ('trapezium', 'Trapézio (osso do carpo)', 'm'), ('trapezoid', 'Trapezoide', 'm'), ('capitate', 'Capitato', 'm'), ('hamate', 'Hamato', 'm'),
    ('atlas', 'Atlas (C1)', 'm'), ('axis', 'Áxis (C2)', 'm'),
    ('manubrium', 'Manúbrio do esterno', 'm'), ('body of sternum', 'Esterno', 'm'), ('xiphoid process', 'Processo xifoide', 'm'),
    ('hyoid bone', 'Osso hioide', 'm'),
    ('frontal bone', 'Osso frontal', 'm'), ('parietal bone', 'Osso parietal', 'm'), ('occipital bone', 'Osso occipital', 'm'),
    ('temporal bone', 'Osso temporal', 'm'), ('sphenoid bone', 'Esfenoide', 'm'), ('ethmoid', 'Etmoide', 'm'),
    ('maxilla', 'Maxila', 'f'), ('mandible', 'Mandíbula', 'f'), ('zygomatic bone', 'Zigomático (maçã do rosto)', 'm'),
    ('nasal bone', 'Osso nasal', 'm'), ('lacrimal bone', 'Lacrimal', 'm'), ('palatine bone', 'Palatino', 'm'),
    ('vomer', 'Vômer', 'm'), ('inferior nasal concha', 'Concha nasal inferior', 'f'),
])
for i, o in enumerate(ORD):
    add('bones', 'bone', [(f'{o} rib', f'{PT_ORD[i]} costela', 'f')])
    if i < 5:
        add('bones', 'bone', [(f'{o} metacarpal bone', f'{PT_ORDM[i]} metacarpo', 'm'),
                              (f'{o} metatarsal bone', f'{PT_ORDM[i]} metatarso', 'm'),
                              (f'{o} lumbar vertebra', f'Vértebra L{i + 1}', 'f')])
    add('bones', 'bone', [(f'{o} thoracic vertebra', f'Vértebra T{i + 1}', 'f')])
    if 2 <= i <= 6:
        add('bones', 'bone', [(f'{o} cervical vertebra', f'Vértebra C{i + 1}', 'f')])

FING = {'thumb': 'do polegar', 'index finger': 'do indicador', 'middle finger': 'do dedo médio',
        'ring finger': 'do anelar', 'little finger': 'do dedo mínimo',
        'big toe': 'do hálux (dedão)', 'second toe': 'do 2º dedo do pé', 'third toe': 'do 3º dedo do pé',
        'fourth toe': 'do 4º dedo do pé', 'little toe': 'do dedo mínimo do pé'}
for f, pt in FING.items():
    for en, ptp in (('proximal', 'proximal'), ('middle', 'média'), ('distal', 'distal')):
        add('bones', 'bone', [(f'{en} phalanx of {f}', f'Falange {ptp} {pt}', 'f')])

TEETH = {
    'central secondary incisor tooth': 'Incisivo central', 'lateral secondary incisor tooth': 'Incisivo lateral',
    'secondary canine tooth': 'Canino', 'first secondary premolar tooth': '1º pré-molar',
    'second secondary premolar tooth': '2º pré-molar', 'first secondary molar tooth': '1º molar',
    'second secondary molar tooth': '2º molar'}
for jaw, ptj in (('upper', 'superior'), ('lower', 'inferior')):
    for en, pt in TEETH.items():
        add('bones', 'tooth', [(f'{jaw} {en}', f'{pt} {ptj}', 'm')])
add('bones', 'gum', [('gingiva of upper jaw', 'Gengiva superior', 'f'), ('gingiva of lower jaw', 'Gengiva inferior', 'f')])

add('bones', 'cartilage', [('costal cartilage', 'Cartilagens costais', 'fp'), ('thyroid cartilage', 'Cartilagem tireoide', 'f'),
                           ('set of nasal cartilages', 'Cartilagens do nariz', 'fp')])
for i, o in enumerate(ORD[:7]):
    add('bones', 'cartilage', [(f'{o} costal cartilage', f'Cartilagem da {PT_ORD[i]} costela', 'f')])

# Discos: "disk of X vertebra" = disco logo abaixo da vértebra X
LEVELS = {'axis': 'C2-C3'}
for i, o in enumerate(ORD):
    LEVELS[f'{o} thoracic vertebra'] = f'T{i + 1}-' + (f'T{i + 2}' if i < 11 else 'L1')
    if i < 5:
        LEVELS[f'{o} lumbar vertebra'] = f'L{i + 1}-' + (f'L{i + 2}' if i < 4 else 'S1')
    if 2 <= i <= 6:
        LEVELS[f'{o} cervical vertebra'] = f'C{i + 1}-' + (f'C{i + 2}' if i < 6 else 'T1')
for v, lv in LEVELS.items():
    add('bones', 'disc', [(f'intervertebral disk of {v}', f'Disco {lv}', 'm')])

# ─── Músculos ─────────────────────────────────────────────────────────────────
# (nome, português, gênero, chave em muscle-data.js)
MUS = [
    # cabeça
    ('frontalis', 'Frontal', 'm', 'frontal'), ('occipitalis', 'Occipital', 'm', None),
    ('temporoparietalis', 'Temporoparietal', 'm', None), ('temporalis', 'Temporal', 'm', 'temporal'),
    ('superficial part of masseter', 'Masseter (parte superficial)', 'm', 'masseter'),
    ('deep part of masseter', 'Masseter (parte profunda)', 'm', 'masseter'),
    ('medial pterygoid', 'Pterigóideo medial', 'm', None),
    ('upper head of lateral pterygoid', 'Pterigóideo lateral (cabeça superior)', 'm', None),
    ('lower head of lateral pterygoid', 'Pterigóideo lateral (cabeça inferior)', 'm', None),
    ('orbicularis oris', 'Orbicular da boca', 'm', 'musculosFace'),
    ('orbital part of orbicularis oculi', 'Orbicular do olho', 'm', 'musculosFace'),
    ('palpebral part of orbicularis oculi', 'Orbicular do olho (pálpebra)', 'm', 'musculosFace'),
    ('zygomaticus major', 'Zigomático maior', 'm', 'musculosFace'), ('zygomaticus minor', 'Zigomático menor', 'm', 'musculosFace'),
    ('buccinator', 'Bucinador', 'm', 'musculosFace'), ('risorius', 'Risório', 'm', 'musculosFace'),
    ('levator labii superioris', 'Levantador do lábio superior', 'm', 'musculosFace'),
    ('levator labii superioris alaeque nasi', 'Levantador do lábio superior e da asa do nariz', 'm', 'musculosFace'),
    ('levator anguli oris', 'Levantador do ângulo da boca', 'm', 'musculosFace'),
    ('depressor anguli oris', 'Abaixador do ângulo da boca', 'm', 'musculosFace'),
    ('depressor labii inferioris', 'Abaixador do lábio inferior', 'm', 'musculosFace'),
    ('depressor septi nasi', 'Abaixador do septo nasal', 'm', 'musculosFace'),
    ('mentalis', 'Mentual', 'm', 'musculosFace'), ('nasalis', 'Nasal', 'm', 'musculosFace'),
    ('procerus', 'Prócero', 'm', 'musculosFace'), ('corrugator supercilii', 'Corrugador do supercílio', 'm', 'musculosFace'),
    # pescoço
    ('sternocleidomastoid', 'Esternocleidomastoideo', 'm', 'esternocleidomastoideo'),
    ('platysma', 'Platisma', 'm', None),
    ('sternohyoid', 'Esterno-hioideo', 'm', 'pescocoAnterior'), ('sternothyroid', 'Esternotireoideo', 'm', 'pescocoAnterior'),
    ('omohyoid', 'Omo-hioideo', 'm', 'pescocoAnterior'), ('thyrohyoid', 'Tíreo-hioideo', 'm', 'pescocoAnterior'),
    ('anterior belly of digastric', 'Digástrico (ventre anterior)', 'm', 'pescocoAnterior'),
    ('posterior belly of digastric', 'Digástrico (ventre posterior)', 'm', 'pescocoAnterior'),
    ('mylohyoid', 'Milo-hioideo', 'm', 'pescocoAnterior'), ('stylohyoid', 'Estilo-hioideo', 'm', 'pescocoAnterior'),
    ('geniohyoid', 'Gênio-hioideo', 'm', 'pescocoAnterior'),
    ('scalenus anterior', 'Escaleno anterior', 'm', None), ('scalenus medius', 'Escaleno médio', 'm', None),
    ('scalenus posterior', 'Escaleno posterior', 'm', None), ('longus capitis', 'Longo da cabeça', 'm', None),
    ('superior oblique part of longus colli', 'Longo do pescoço', 'm', None),
    ('inferior oblique part of longus colli', 'Longo do pescoço', 'm', None),
    ('vertical intermediate part of longus colli', 'Longo do pescoço', 'm', None),
    ('rectus capitis anterior', 'Reto anterior da cabeça', 'm', None), ('rectus capitis lateralis', 'Reto lateral da cabeça', 'm', None),
    ('levator scapulae', 'Levantador da escápula', 'm', None),
    ('splenius capitis', 'Esplênio da cabeça', 'm', None), ('splenius cervicis', 'Esplênio do pescoço', 'm', None),
    ('semispinalis capitis', 'Semiespinal da cabeça', 'm', None), ('semispinalis cervicis', 'Semiespinal do pescoço', 'm', None),
    ('semispinalis thoracis', 'Semiespinal do tórax', 'm', None),
    ('rectus capitis posterior major', 'Reto posterior maior da cabeça', 'm', None),
    ('rectus capitis posterior minor', 'Reto posterior menor da cabeça', 'm', None),
    ('obliquus capitis inferior', 'Oblíquo inferior da cabeça', 'm', None),
    ('obliquus capitis superior', 'Oblíquo superior da cabeça', 'm', None),
    # ombro e tronco
    ('descending part of trapezius', 'Trapézio (parte superior)', 'm', 'trapezio'),
    ('transverse part of trapezius', 'Trapézio (parte média)', 'm', 'trapezio'),
    ('ascending part of trapezius', 'Trapézio (parte inferior)', 'm', 'trapezio'),
    ('clavicular part of deltoid', 'Deltoide (parte anterior)', 'm', 'deltoide'),
    ('acromial part of deltoid', 'Deltoide (parte média)', 'm', 'deltoide'),
    ('spinal part of deltoid', 'Deltoide (parte posterior)', 'm', 'deltoide'),
    ('clavicular part of pectoralis major', 'Peitoral maior (parte clavicular)', 'm', 'peitoralMaior'),
    ('sternocostal part of pectoralis major', 'Peitoral maior (parte esternocostal)', 'm', 'peitoralMaior'),
    ('abdominal part of pectoralis major', 'Peitoral maior (parte abdominal)', 'm', 'peitoralMaior'),
    ('pectoralis minor', 'Peitoral menor', 'm', None), ('subclavius', 'Subclávio', 'm', None),
    ('serratus anterior', 'Serrátil anterior', 'm', 'serratilAnterior'),
    ('serratus posterior superior', 'Serrátil posterior superior', 'm', None),
    ('serratus posterior inferior', 'Serrátil posterior inferior', 'm', None),
    ('rectus abdominis', 'Reto abdominal', 'm', 'retoAbdominal'), ('pyramidalis', 'Piramidal', 'm', 'retoAbdominal'),
    ('external oblique', 'Oblíquo externo', 'm', 'obliquoExterno'), ('internal oblique', 'Oblíquo interno', 'm', None),
    ('transversus abdominis', 'Transverso do abdome', 'm', None), ('transversus thoracis', 'Transverso do tórax', 'm', None),
    ('latissimus dorsi', 'Grande dorsal', 'm', 'grandeDorsal'),
    ('infraspinatus muscle', 'Infraespinal', 'm', 'infraespinal'), ('supraspinatus', 'Supraespinal', 'm', None),
    ('subscapularis', 'Subescapular', 'm', None), ('teres minor', 'Redondo menor', 'm', None),
    ('teres major', 'Redondo maior', 'm', 'redondoMaior'),
    ('rhomboid major', 'Romboide maior', 'm', None), ('rhomboid minor', 'Romboide menor', 'm', None),
    ('iliocostalis lumborum', 'Iliocostal lombar', 'm', 'eretores'), ('iliocostalis thoracis', 'Iliocostal do tórax', 'm', 'eretores'),
    ('iliocostalis cervicis', 'Iliocostal do pescoço', 'm', 'eretores'), ('longissimus thoracis', 'Longuíssimo do tórax', 'm', 'eretores'),
    ('longissimus cervicis', 'Longuíssimo do pescoço', 'm', 'eretores'), ('longissimus capitis', 'Longuíssimo da cabeça', 'm', 'eretores'),
    ('spinalis thoracis', 'Espinal do tórax', 'm', 'eretores'), ('spinalis cervicis', 'Espinal do pescoço', 'm', 'eretores'),
    ('multifidus', 'Multífido', 'm', None), ('quadratus lumborum', 'Quadrado lombar', 'm', None),
    ('thoracic rotator', 'Rotadores do tórax', 'mp', None), ('lumbar rotator', 'Rotadores lombares', 'mp', None),
    ('cervical rotator', 'Rotadores do pescoço', 'mp', None),
    ('set of interspinales cervicis', 'Interespinais do pescoço', 'mp', None),
    ('set of interspinales thoracis', 'Interespinais do tórax', 'mp', None),
    ('set of interspinales lumborum', 'Interespinais lombares', 'mp', None),
    ('set of anterior cervical intertransversarii', 'Intertransversários do pescoço', 'mp', None),
    ('set of posterior cervical intertransversarii', 'Intertransversários do pescoço', 'mp', None),
    ('set of lateral lumbar intertransversarius muscles', 'Intertransversários lombares', 'mp', None),
    ('set of medial lumbar intertransversarius muscles', 'Intertransversários lombares', 'mp', None),
    ('set of levatores costarum breves', 'Levantadores das costelas', 'mp', None),
    ('set of levatores costarum longi', 'Levantadores das costelas', 'mp', None),
    ('external intercostal muscle', 'Intercostais externos', 'mp', None),
    # braço
    ('long head of biceps brachii', 'Bíceps braquial (cabeça longa)', 'm', 'biceps'),
    ('short head of biceps brachii', 'Bíceps braquial (cabeça curta)', 'm', 'biceps'),
    ('brachialis', 'Braquial', 'm', 'braquial'), ('coracobrachialis', 'Coracobraquial', 'm', None),
    ('long head of triceps brachii', 'Tríceps (cabeça longa)', 'm', 'triceps'),
    ('lateral head of triceps brachii', 'Tríceps (cabeça lateral)', 'm', 'triceps'),
    ('medial head of triceps brachii', 'Tríceps (cabeça medial)', 'm', 'triceps'),
    ('anconeus', 'Ancôneo', 'm', None), ('brachioradialis', 'Braquiorradial', 'm', 'braquiorradial'),
    # antebraço
    ('flexor carpi radialis', 'Flexor radial do carpo', 'm', 'flexoresAntebraco'),
    ('palmaris longus', 'Palmar longo', 'm', 'flexoresAntebraco'),
    ('humeral head of flexor carpi ulnaris', 'Flexor ulnar do carpo', 'm', 'flexoresAntebraco'),
    ('ulnar head of flexor carpi ulnaris', 'Flexor ulnar do carpo', 'm', 'flexoresAntebraco'),
    ('humeroulnar head of flexor digitorum superficialis', 'Flexor superficial dos dedos', 'm', 'flexoresAntebraco'),
    ('radial head of flexor digitorum superficialis', 'Flexor superficial dos dedos', 'm', 'flexoresAntebraco'),
    ('flexor digitorum profundus', 'Flexor profundo dos dedos', 'm', 'flexoresAntebraco'),
    ('flexor pollicis longus', 'Flexor longo do polegar', 'm', 'flexoresAntebraco'),
    ('humeral head of pronator teres', 'Pronador redondo', 'm', 'flexoresAntebraco'),
    ('ulnar head of pronator teres', 'Pronador redondo', 'm', 'flexoresAntebraco'),
    ('pronator quadratus', 'Pronador quadrado', 'm', None), ('supinator', 'Supinador', 'm', None),
    ('extensor carpi radialis longus', 'Extensor radial longo do carpo', 'm', 'extensoresAntebraco'),
    ('extensor carpi radialis brevis', 'Extensor radial curto do carpo', 'm', 'extensoresAntebraco'),
    ('extensor digitorum', 'Extensor dos dedos', 'm', 'extensoresAntebraco'),
    ('extensor digiti minimi', 'Extensor do dedo mínimo', 'm', 'extensoresAntebraco'),
    ('humeral head of extensor carpi ulnaris', 'Extensor ulnar do carpo', 'm', 'extensoresAntebraco'),
    ('ulnar head of extensor carpi ulnaris', 'Extensor ulnar do carpo', 'm', 'extensoresAntebraco'),
    ('abductor pollicis longus', 'Abdutor longo do polegar', 'm', 'extensoresAntebraco'),
    ('extensor pollicis brevis', 'Extensor curto do polegar', 'm', 'extensoresAntebraco'),
    ('extensor pollicis longus', 'Extensor longo do polegar', 'm', 'extensoresAntebraco'),
    ('extensor indicis', 'Extensor do indicador', 'm', 'extensoresAntebraco'),
    # mão
    ('abductor pollicis brevis', 'Abdutor curto do polegar', 'm', 'tenar'),
    ('superficial head of flexor pollicis brevis', 'Flexor curto do polegar', 'm', 'tenar'),
    ('deep head of flexor pollicis brevis', 'Flexor curto do polegar', 'm', 'tenar'),
    ('opponens pollicis', 'Oponente do polegar', 'm', 'tenar'),
    ('oblique head of adductor pollicis', 'Adutor do polegar', 'm', 'tenar'),
    ('transverse head of adductor pollicis', 'Adutor do polegar', 'm', 'tenar'),
    ('abductor digiti minimi of hand', 'Abdutor do dedo mínimo', 'm', 'hipotenar'),
    ('flexor digiti minimi brevis of hand', 'Flexor curto do dedo mínimo', 'm', 'hipotenar'),
    ('opponens digiti minimi of hand', 'Oponente do dedo mínimo', 'm', 'hipotenar'),
    ('set of lumbricals of hand', 'Lumbricais da mão', 'mp', None),
    ('set of dorsal interossei of hand', 'Interósseos dorsais da mão', 'mp', None),
    ('set of palmar interossei of hand', 'Interósseos palmares', 'mp', None),
    # quadril e coxa
    ('gluteus maximus', 'Glúteo máximo', 'm', 'gluteoMaximo'), ('gluteus medius', 'Glúteo médio', 'm', 'gluteoMedio'),
    ('gluteus minimus', 'Glúteo mínimo', 'm', None), ('tensor fasciae latae', 'Tensor da fáscia lata', 'm', 'tensorFascia'),
    ('piriformis', 'Piriforme', 'm', None), ('gemellus superior', 'Gêmeo superior', 'm', None),
    ('gemellus inferior', 'Gêmeo inferior', 'm', None), ('obturator internus', 'Obturador interno', 'm', None),
    ('obturator externus', 'Obturador externo', 'm', None), ('quadratus femoris', 'Quadrado femoral', 'm', None),
    ('iliacus', 'Ilíaco', 'm', None), ('psoas major', 'Psoas maior', 'm', None),
    ('sartorius', 'Sartório', 'm', 'sartorio'), ('rectus femoris', 'Reto femoral (quadríceps)', 'm', 'retoFemoral'),
    ('vastus lateralis', 'Vasto lateral', 'm', 'vastoLateral'), ('vastus medialis', 'Vasto medial', 'm', 'vastoMedial'),
    ('vastus intermedius', 'Vasto intermédio', 'm', None),
    ('adductor longus', 'Adutor longo', 'm', 'adutores'), ('adductor brevis', 'Adutor curto', 'm', 'adutores'),
    ('adductor magnus', 'Adutor magno', 'm', 'adutores'), ('adductor minimus', 'Adutor mínimo', 'm', 'adutores'),
    ('pectineus', 'Pectíneo', 'm', 'adutores'), ('gracilis', 'Grácil', 'm', 'adutores'),
    ('long head of biceps femoris', 'Bíceps femoral (cabeça longa)', 'm', 'bicepsFemoral'),
    ('short head of biceps femoris', 'Bíceps femoral (cabeça curta)', 'm', 'bicepsFemoral'),
    ('semitendinosus', 'Semitendíneo', 'm', 'semitendineo'), ('semimembranosus', 'Semimembranáceo', 'm', None),
    # perna e pé
    ('medial head of gastrocnemius', 'Gastrocnêmio medial', 'm', 'gastroMedial'),
    ('lateral head of gastrocnemius', 'Gastrocnêmio lateral', 'm', 'gastroLateral'),
    ('soleus', 'Sóleo', 'm', 'soleo'), ('plantaris', 'Plantar', 'm', None), ('popliteus', 'Poplíteo', 'm', None),
    ('tibialis anterior', 'Tibial anterior', 'm', 'tibialAnterior'), ('tibialis posterior', 'Tibial posterior', 'm', None),
    ('extensor digitorum longus', 'Extensor longo dos dedos', 'm', 'extensoresPe'),
    ('extensor hallucis longus', 'Extensor longo do hálux', 'm', 'extensoresPe'),
    ('fibularis tertius', 'Fibular terceiro', 'm', 'extensoresPe'),
    ('extensor digitorum brevis', 'Extensor curto dos dedos', 'm', 'extensoresPe'),
    ('extensor hallucis brevis', 'Extensor curto do hálux', 'm', 'extensoresPe'),
    ('fibularis longus', 'Fibular longo', 'm', 'fibulares'), ('fibularis brevis', 'Fibular curto', 'm', 'fibulares'),
    ('flexor digitorum longus', 'Flexor longo dos dedos', 'm', None), ('flexor hallucis longus', 'Flexor longo do hálux', 'm', None),
    ('abductor hallucis', 'Abdutor do hálux', 'm', None), ('flexor digitorum brevis', 'Flexor curto dos dedos', 'm', None),
    ('abductor digiti minimi of foot', 'Abdutor do dedo mínimo do pé', 'm', None),
    ('flexor accessorius', 'Quadrado plantar', 'm', None),
    ('medial head of flexor hallucis brevis', 'Flexor curto do hálux', 'm', None),
    ('lateral head of flexor hallucis brevis', 'Flexor curto do hálux', 'm', None),
    ('oblique head of adductor hallucis', 'Adutor do hálux', 'm', None),
    ('transverse head of adductor hallucis', 'Adutor do hálux', 'm', None),
    ('flexor digiti minimi brevis of foot', 'Flexor curto do dedo mínimo do pé', 'm', None),
    ('opponens digiti minimi of foot', 'Oponente do dedo mínimo do pé', 'm', None),
    ('set of dorsal interossei of foot', 'Interósseos dorsais do pé', 'mp', None),
    ('first plantar interosseous of foot', 'Interósseos plantares', 'mp', None),
    ('second plantar interosseous of foot', 'Interósseos plantares', 'mp', None),
    ('third plantar interosseous of foot', 'Interósseos plantares', 'mp', None),
    ('first lumbrical of foot', 'Lumbricais do pé', 'mp', None), ('second lumbrical of foot', 'Lumbricais do pé', 'mp', None),
    ('third lumbrical of foot', 'Lumbricais do pé', 'mp', None), ('fourth lumbrical of foot', 'Lumbricais do pé', 'mp', None),
    # assoalho pélvico
    ('coccygeus', 'Coccígeo', 'm', None), ('iliococcygeus', 'Iliococcígeo', 'm', None), ('pubococcygeus', 'Pubococcígeo', 'm', None),
    ('puborectalis', 'Puborretal', 'm', None), ('external anal sphincter', 'Esfíncter externo do ânus', 'm', None),
]
MUSCLE_KEY = {}
for en, pt, g, key in MUS:
    T[en] = ('muscles', 'muscle', pt, g)
    if key:
        MUSCLE_KEY[en] = key

add('muscles', 'tendon', [
    ('calcaneal tendon', 'Tendão de Aquiles', 'm'), ('intermediate tendon', 'Tendão do digástrico', 'm'),
    ('iliotibial tract', 'Trato iliotibial', 'm'), ('aponeurosis of epicranius', 'Gálea aponeurótica', 'f'),
    ('linea alba', 'Linha alba', 'f'), ('flexor retinaculum of wrist', 'Retináculo dos flexores (túnel do carpo)', 'm'),
    ('inguinal ligament', 'Ligamento inguinal', 'm'), ('long plantar ligament', 'Ligamento plantar longo', 'm'),
    ('interosseous membrane of forearm', 'Membrana interóssea do antebraço', 'f'),
    ('interosseous membrane of leg', 'Membrana interóssea da perna', 'f'),
    ('tendinous arch of levator ani', 'Arco tendíneo do levantador do ânus', 'm'),
])
MUSCLE_KEY['calcaneal tendon'] = 'aquiles'
MUSCLE_KEY['iliotibial tract'] = 'tratoIliotibial'

# ─── Órgãos e vasos (camada "organs") ────────────────────────────────────────
# (nome, português, gênero, tecido, meridiano da acupuntura)
ORG = [
    ('upper lobe of lung', 'Pulmão (lobo superior)', 'm', 'lung', 'LU'), ('middle lobe of lung', 'Pulmão (lobo médio)', 'm', 'lung', 'LU'),
    ('lower lobe of lung', 'Pulmão (lobo inferior)', 'm', 'lung', 'LU'), ('bronchus', 'Brônquios', 'mp', 'airway', 'LU'),
    ('trachea', 'Traqueia', 'f', 'airway', 'LU'),
    ('wall of heart', 'Coração', 'm', 'heart', 'HT'),
    ('liver', 'Fígado', 'm', 'liver', 'LR'), ('gallbladder', 'Vesícula biliar', 'f', 'gallbladder', 'GB'),
    ('stomach', 'Estômago', 'm', 'stomach', 'ST'), ('esophagus', 'Esôfago', 'm', 'stomach', 'ST'),
    ('spleen', 'Baço', 'm', 'spleen', 'SP'), ('pancreas, nsn', 'Pâncreas', 'm', 'pancreas', 'SP'),
    ('pancreatic duct', 'Ducto pancreático', 'm', 'pancreas', 'SP'),
    ('duodenum', 'Duodeno', 'm', 'smallint', 'SI'), ('jejunum', 'Jejuno', 'm', 'smallint', 'SI'), ('ileum', 'Íleo', 'm', 'smallint', 'SI'),
    ('colon, nsn', 'Intestino grosso (cólon)', 'm', 'colon', 'LI'), ('free taenia', 'Cólon (tênia)', 'm', 'colon', 'LI'),
    ('mesocolic taenia', 'Cólon (tênia)', 'm', 'colon', 'LI'), ('omental taenia', 'Cólon (tênia)', 'm', 'colon', 'LI'),
    ('appendix', 'Apêndice', 'm', 'colon', 'LI'), ('rectum', 'Reto', 'm', 'colon', 'LI'),
    ('kidney', 'Rim', 'm', 'kidney', 'KI'), ('adrenal gland', 'Glândula suprarrenal', 'f', 'adrenal', 'KI'),
    ('ureter', 'Ureter', 'm', 'urinary', 'BL'), ('urinary bladder', 'Bexiga', 'f', 'bladder', 'BL'),
    ('lobe of thymus', 'Timo', 'm', 'thymus', None), ('diaphragm', 'Diafragma', 'm', 'diaphragm', None),
    ('arch of aorta', 'Aorta', 'f', 'artery', 'HT'), ('ascending aorta', 'Aorta', 'f', 'artery', 'HT'),
    ('descending aorta', 'Aorta', 'f', 'artery', None), ('brachiocephalic artery, nsn', 'Tronco braquiocefálico', 'm', 'artery', None),
    ('common carotid artery', 'Artéria carótida', 'f', 'artery', None), ('subclavian artery', 'Artéria subclávia', 'f', 'artery', None),
    ('celiac artery', 'Tronco celíaco', 'm', 'artery', None), ('common hepatic artery', 'Artéria hepática', 'f', 'artery', None),
    ('gastric artery', 'Artéria gástrica', 'f', 'artery', None), ('splenic artery', 'Artéria esplênica', 'f', 'artery', None),
    ('superior mesenteric artery', 'Artéria mesentérica superior', 'f', 'artery', None),
    ('inferior mesenteric artery', 'Artéria mesentérica inferior', 'f', 'artery', None),
    ('renal artery', 'Artéria renal', 'f', 'artery', None), ('common iliac artery', 'Artéria ilíaca comum', 'f', 'artery', None),
    ('external iliac artery', 'Artéria ilíaca externa', 'f', 'artery', None), ('internal iliac artery', 'Artéria ilíaca interna', 'f', 'artery', None),
    ('pulmonary artery', 'Artéria pulmonar', 'f', 'artery', 'LU'),
    ('superior vena cava', 'Veia cava superior', 'f', 'vein', None), ('inferior vena cava', 'Veia cava inferior', 'f', 'vein', None),
    ('brachiocephalic vein', 'Veia braquiocefálica', 'f', 'vein', None), ('internal jugular vein', 'Veia jugular interna', 'f', 'vein', None),
    ('subclavian vein', 'Veia subclávia', 'f', 'vein', None), ('pulmonary vein', 'Veias pulmonares', 'fp', 'vein', 'LU'),
    ('renal vein', 'Veia renal', 'f', 'vein', None), ('splenic vein', 'Veia esplênica', 'f', 'vein', None),
    ('superior mesenteric vein', 'Veia mesentérica superior', 'f', 'vein', None),
    ('common iliac vein', 'Veia ilíaca comum', 'f', 'vein', None), ('external iliac vein', 'Veia ilíaca externa', 'f', 'vein', None),
    ('internal iliac vein', 'Veia ilíaca interna', 'f', 'vein', None),
]
ORGAN_MERIDIAN = {}
for en, pt, g, kind, mer in ORG:
    T[en] = ('organs', kind, pt, g)
    if mer:
        ORGAN_MERIDIAN[en] = mer

SIDE_PT = {'m': ('direito', 'esquerdo'), 'f': ('direita', 'esquerda'),
           'mp': ('direitos', 'esquerdos'), 'fp': ('direitas', 'esquerdas')}


def classify(name):
    """Nome do BodyParts3D → dict com camada, tecido, rótulo, lado, chave; ou None."""
    side = None
    m = re.search(r'\b(right|left)\b', name)
    if m:
        side = 'D' if m.group(1) == 'right' else 'E'
    base = re.sub(r'\b(right|left)\b ?', '', name).replace('  ', ' ').strip()
    if base not in T:
        return None
    layer, kind, pt, g = T[base]
    label = pt
    if side:
        # "Pulmão (lobo superior)" → "Pulmão direito (lobo superior)"
        adj = SIDE_PT[g][0 if side == 'D' else 1]
        label = re.sub(r'^([^(]+?)( \(|$)', lambda mm: f'{mm.group(1)} {adj}{mm.group(2)}', pt, count=1)
    return {'base': base, 'layer': layer, 'kind': kind, 'label': label, 'name': pt, 'side': side,
            'key': MUSCLE_KEY.get(base), 'meridian': ORGAN_MERIDIAN.get(base)}
