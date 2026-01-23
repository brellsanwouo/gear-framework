from flamapy.core.discover import DiscoverMetamodels

dm = DiscoverMetamodels()

feature_model = dm.use_transformation_t2m('/home/bsanwouo/Documents/SCX_Prime/INRIA & Recherche/Projets/Artefacts/From_chaos_to_FM/generic_FM_agent', 'fm')

print(feature_model)