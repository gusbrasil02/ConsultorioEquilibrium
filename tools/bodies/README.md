# Corpos 3D realistas (masculino e feminino)

Os arquivos `public/models/body-male.glb` e `public/models/body-female.glb` são
gerados a partir do **MakeHuman** — malha-base, deformações, peles, olhos,
sobrancelhas, cílios e cabelos, todos licenciados **CC0** (domínio público, uso
comercial livre).

Só é preciso regerar se quiser mudar a aparência (pele, cabelo, proporções).

## 1. Baixar os ativos (uma vez)

Numa pasta qualquer (ex.: `C:\mh`):

```
data/base.obj
    https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/3dobjs/base.obj
data/targets/<nome>.target      (os nomes estão em MODELS, em build_bodies.py)
    https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/targets/macrodetails/<nome>.target
assets/                          (descompacte aqui)
    https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
```

## 2. Gerar

Requer Python 3 com `numpy` e `pillow`.

```
python tools/bodies/build_bodies.py C:\mh          # os dois
python tools/bodies/build_bodies.py C:\mh female   # só um
npm run build:acupoints                             # reposiciona os pontos nos corpos novos
```

## O que o gerador faz

- aplica as deformações de sexo/idade/musculatura na malha-base;
- encaixa olhos, sobrancelhas, cílios e cabelo pelo arquivo `.mhclo` de cada um
  (cada vértice do acessório é preso a 3 vértices do corpo);
- pinta roupa íntima neutra (grafite) na textura da pele, pixel a pixel, para uso
  na TV do consultório — os pontos continuam visíveis por cima;
- normaliza (pés em Y=0, altura final, +Z = frente, X negativo = lado direito do
  paciente) e grava o `.glb` e um `.joints.json` com as juntas do esqueleto,
  usadas pelo gerador de pontos (`tools/acupoints`).

As configurações de cada corpo (pele, cabelo, cor dos olhos, altura) estão no
dicionário `MODELS`, no topo de `build_bodies.py`.
